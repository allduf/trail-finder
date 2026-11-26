// Season goals and a season recap (alex 2026-11-19: "Ride 10 trails new to you this season", with progress, and a
// recap you can share, "34 rides, 12 new trails"). Each sport has its own season, goals and recap:
//  - Mountain biking (Jan to Dec): trails new to you, rides. A trail is new to you the first time one of your saved
//    rides covers it (rides.js, tfRiddenGps().first, bike rides only) or you mark it + Ridden (index.html's Ridden
//    folder). The first time is kept per trail name in tf:riddenFirst, so trails outside the loaded area still count.
//  - Skiing (Sept to Aug): days out. No vertical, steepness or new-zone goals: nothing here asks for more avalanche terrain.
//  - Hiking (Jan to Dec): hikes, km.   Adventure moto (Jan to Dec): rides, km.
//  - Fishing (April to March, the licence year): catches, species (ski-points.js catches).
//  - Hunting (April to March): days out. No harvest goal, and the recap is private: no Share button.
// Goals are kept in tf:seasonGoals ({ sport: { goal id: target, 0 = off } }) and follow the account (account.js).
// The recap is a picture made on this device with numbers only: no map, no trail, lake or place names, so unofficial
// trails and spots never show. It's shared only when the person taps Share.
// Opened from Saved (index.html, card "season"): window.tfSeason.open(). window.tfSeason.line(sport) is a short
// progress line for that card, from the last count.
(() => {
  "use strict";
  if (window.tfSeason) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const T = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);
  const FR = !!(window.tfLang && window.tfLang.lang === "fr");
  const LOC = FR ? "fr-CA" : "en-CA", COLON = FR ? " : " : ": ";
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {   // "tf:setting" tells account.js (optional sign-in) to save it to the person's account
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const sportNow = () => { const b = document.body.classList; return b.contains("sport-ski") ? "ski" : b.contains("sport-hunt") ? "hunt" : b.contains("sport-fish") ? "fish" : b.contains("sport-moto") ? "moto" : b.contains("sport-hike") ? "hike" : "mtb"; };

  // ---------- seasons ----------
  // start month (0 = January): the calendar year, the ski season from September, the licence year from April.
  const START = { mtb: 0, hike: 0, moto: 0, ski: 8, fish: 3, hunt: 3 };
  function seasonOf(sport, back = 0, now = new Date()) {
    const m0 = START[sport] || 0;
    let y = now.getFullYear() - (now.getMonth() < m0 ? 1 : 0) - back;
    const from = new Date(y, m0, 1).getTime(), to = new Date(y + 1, m0, 1).getTime();
    return { from, to, label: m0 ? `${y}-${String((y + 1) % 100).padStart(2, "0")}` : String(y) };
  }

  // ---------- each sport's goals and recap ----------
  // id, words, default target. The recap's numbers: [stat id, words].
  const SPORTS = {
    mtb: { name: "Mountain bike season", icon: "bike", color: "#b8f03a",
      goals: [["newTrails", "Trails new to you", 10], ["rides", "Rides", 30]],
      recap: [["rides", "Rides"], ["newTrails", "Trails new to you"], ["km", "Kilometres"], ["climb", "Metres climbed"]] },
    ski: { name: "Ski season", icon: "ski", color: "#8fd0ff",
      goals: [["days", "Days out", 20]],
      recap: [["days", "Days out"], ["outings", "Tours recorded"], ["km", "Kilometres"], ["climb", "Metres climbed"]] },
    hike: { name: "Hiking season", icon: "boot", color: "#ffd166",
      goals: [["hikes", "Hikes", 20], ["km", "Kilometres hiked", 150]],
      recap: [["hikes", "Hikes"], ["km", "Kilometres"], ["climb", "Metres climbed"], ["days", "Days out"]] },
    fish: { name: "Fishing season", icon: "fish", color: "#5fd3c8",
      goals: [["catches", "Catches", 25], ["species", "Species caught", 5]],
      recap: [["catches", "Catches"], ["species", "Species caught"], ["released", "Released"], ["days", "Days out"]] },
    hunt: { name: "Hunting season", icon: "hunt", color: "#d9a066", private: true,
      goals: [["days", "Days out", 15]],
      recap: [["days", "Days out"], ["outings", "Hunts tracked"], ["km", "Kilometres walked"]] },
    moto: { name: "Adventure moto season", icon: "moto", color: "#f4a261",
      goals: [["rides", "Rides", 15], ["km", "Kilometres", 2000]],
      recap: [["rides", "Rides"], ["km", "Kilometres"], ["days", "Days out"], ["climb", "Metres climbed"]] },
  };
  const goalsOf = (sp) => {
    const saved = (store.get("seasonGoals", {}) || {})[sp] || {};
    return SPORTS[sp].goals.map(([id, words, def]) => ({ id, words, target: saved[id] == null ? def : Math.max(0, Math.min(99999, Math.round(+saved[id] || 0))) }));
  };
  function setGoal(sp, id, n) {
    const all = { ...(store.get("seasonGoals", {}) || {}) };
    all[sp] = { ...(all[sp] || {}), [id]: Math.max(0, Math.min(99999, Math.round(+n || 0))) };
    store.set("seasonGoals", all);
  }

  // ---------- what was done, from the data already on this device ----------
  const SPECIAL = new Set(["ski", "hunt", "fish", "moto", "hike"]);
  function sportOfRide(r) {
    const s = String(r.sport || "");
    if (SPECIAL.has(s)) return s;
    // Imported rides keep the other app's type ("Run", "Ride"): only bike rides count in mountain biking.
    const bike = window.tfRideFiles && window.tfRideFiles.isBike ? window.tfRideFiles.isBike("", s) : null;
    return bike === false ? null : "mtb";
  }
  function metres(a, b) {
    const R = 6371008.8, rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function distOf(r) {
    if (r.stats && r.stats.dist > 0) return r.stats.dist;
    let d = 0; const p = r.points || [];
    for (let i = 1; i < p.length; i++) { const x = metres(p[i - 1], p[i]); if (x < 5000) d += x; }
    return d;
  }
  // Light copies, one record at a time (a Strava archive can be hundreds of rides).
  function readRides() {
    return new Promise((resolve) => {
      let r;
      try { r = indexedDB.open("trail-finder-rides", 1); } catch { resolve([]); return; }
      r.onupgradeneeded = () => { const db = r.result; db.createObjectStore("rides", { keyPath: "id" }); db.createObjectStore("photos", { keyPath: "id" }).createIndex("rideId", "rideId"); db.createObjectStore("current", { keyPath: "id" }); };
      r.onerror = () => resolve([]);
      r.onsuccess = () => {
        const db = r.result, out = [];
        try {
          const q = db.transaction("rides").objectStore("rides").openCursor();
          q.onsuccess = () => {
            const c = q.result;
            if (!c) { db.close(); resolve(out); return; }
            const x = c.value, sp = x && x.start ? sportOfRide(x) : null;
            if (sp && x.points && x.points.length > 1) out.push({ start: x.start, sport: sp, dist: distOf(x), climb: (x.stats && x.stats.climb) || 0 });
            c.continue();
          };
          q.onerror = () => { db.close(); resolve(out); };
        } catch { db.close(); resolve(out); }
      };
    });
  }
  function readCatches() {
    return new Promise((resolve) => {
      let r;
      try { r = indexedDB.open("trail-finder-points", 1); } catch { resolve([]); return; }
      r.onupgradeneeded = () => r.result.createObjectStore("points", { keyPath: "id" });
      r.onerror = () => resolve([]);
      r.onsuccess = () => {
        const db = r.result, out = [];
        try {
          const q = db.transaction("points").objectStore("points").openCursor();
          q.onsuccess = () => {
            const c = q.result;
            if (!c) { db.close(); resolve(out); return; }
            const p = c.value;
            if (p && p.sport === "fish" && p.kind === "catch") {
              const k = p.catch || {}, d = /^\d{4}-\d{2}-\d{2}$/.test(k.date || "") ? k.date.split("-").map(Number) : null;
              const at = d ? new Date(d[0], d[1] - 1, d[2], 12).getTime() : p.created || 0;
              out.push({ at, species: String(k.species || "").trim().toLowerCase(), released: k.kept === "released" || k.kept === "release" });
            }
            c.continue();
          };
          q.onerror = () => { db.close(); resolve(out); };
        } catch { db.close(); resolve(out); }
      };
    });
  }
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate(); };

  // Trails new to you: the first time each trail was ridden, kept by name (or the folder key for an unnamed trail).
  function firsts() {
    const map = { ...(store.get("riddenFirst", {}) || {}) };
    let changed = false;
    const put = (k, t) => { if (!k || !(t > 0)) return; if (!(map[k] <= t)) { map[k] = t; changed = true; } };
    (window.tfRiddenGps ? window.tfRiddenGps() : []).forEach((w) => put(w.key, w.first));
    const folders = store.get("folders", []), ridden = Array.isArray(folders) ? folders.find((x) => x && x.id === "ridden") : null;
    const gone = new Set((ridden && ridden.gone) || []);
    if (ridden) (ridden.trails || []).forEach((w) => put(w.name ? "g:" + String(w.name).trim().toLowerCase() : w.key, w.at));
    if (changed) store.set("riddenFirst", map);
    return Object.entries(map).filter(([k]) => !gone.has(k));
  }

  let data = null, loading = null;
  async function load(force) {
    if (data && !force) return data;
    if (loading) return loading;
    loading = Promise.all([readRides(), readCatches()]).then(([rides, catches]) => { data = { rides, catches }; loading = null; return data; });
    return loading;
  }
  // The numbers for one sport and season.
  function count(sp, s) {
    const d = data || { rides: [], catches: [] };
    const rs = d.rides.filter((r) => r.sport === sp && r.start >= s.from && r.start < s.to);
    const out = { rides: rs.length, outings: rs.length, hikes: rs.length, km: Math.round(rs.reduce((a, r) => a + r.dist, 0) / 1000),
      climb: Math.round(rs.reduce((a, r) => a + (r.climb || 0), 0)) };
    const days = new Set(rs.map((r) => dayKey(r.start)));
    const months = new Array(12).fill(0);
    rs.forEach((r) => months[new Date(r.start).getMonth()]++);
    if (sp === "fish") {
      const cs = d.catches.filter((c) => c.at >= s.from && c.at < s.to);
      cs.forEach((c) => { days.add(dayKey(c.at)); months[new Date(c.at).getMonth()]++; });
      out.catches = cs.length;
      out.species = new Set(cs.map((c) => c.species).filter(Boolean)).size;
      out.released = cs.filter((c) => c.released).length;
    }
    if (sp === "mtb") out.newTrails = firsts().filter(([, t]) => t >= s.from && t < s.to).length;
    out.days = days.size;
    const top = Math.max(...months);
    out.month = top > 0 ? months.indexOf(top) : -1;
    return out;
  }

  // ---------- the short line for Saved ----------
  const lines = {};
  async function refreshLine() {
    await load(true);
    Object.keys(SPORTS).forEach((sp) => {
      const n = count(sp, seasonOf(sp)), g = goalsOf(sp).filter((x) => x.target > 0);
      lines[sp] = g.length ? g.map((x) => `<span>${esc(x.words)}</span> ${n[x.id] || 0}/${x.target}`).join(" · ") : "";
    });
    window.dispatchEvent(new Event("tf:season"));
  }
  let lineT = 0;
  const refreshSoon = () => { clearTimeout(lineT); lineT = setTimeout(() => { refreshLine(); if (dlg && dlg.open) paint(); }, 400); };
  ["tf:ridden", "tf:points", "tf:rides-imported", "tf:settings-synced"].forEach((e) => window.addEventListener(e, refreshSoon));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshSoon(); });
  setTimeout(refreshLine, 1500);

  // ---------- the sheet ----------
  const css = document.createElement("style");
  css.textContent = `
dialog.ss-dlg { width: min(440px, calc(100vw - 20px)); max-height: calc(100dvh - 40px); padding: 0; border: 1px solid var(--line, #ccd); border-radius: 16px; background: var(--bg, #fff); color: var(--fg, #111); box-shadow: 0 10px 40px rgba(0,0,0,.35); overflow: auto; }
dialog.ss-dlg::backdrop { background: rgba(0,0,0,.45); }
.ss-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 10px; padding: 14px 14px 10px; background: var(--bg, #fff); border-bottom: 1px solid var(--line, #ccd); }
.ss-head h2 { flex: 1; margin: 0; font-size: 1.1rem; }
.ss-head .ss-ic { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--ss, #b8f03a); color: #10230f; }
.ss-x { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line, #ccd); background: transparent; color: inherit; font-size: 1rem; cursor: pointer; }
.ss-body { padding: 12px 14px 16px; }
.ss-seg { display: flex; gap: 6px; margin: 0 0 12px; }
.ss-seg button { flex: 1; min-height: 38px; border-radius: 999px; border: 1px solid var(--line, #ccd); background: transparent; color: inherit; font: inherit; font-size: .9rem; cursor: pointer; }
.ss-seg button[aria-pressed="true"] { background: var(--fg, #111); color: var(--bg, #fff); border-color: var(--fg, #111); }
.ss-sec { margin: 16px 0 8px; font-size: .78rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted, #667); }
.ss-goal { padding: 10px 12px; border: 1px solid var(--line, #ccd); border-radius: 12px; margin-bottom: 8px; }
.ss-goal .ss-row { display: flex; align-items: baseline; gap: 8px; }
.ss-goal b { flex: 1; font-size: .95rem; }
.ss-goal .ss-n { font-variant-numeric: tabular-nums; font-weight: 700; }
.ss-goal .ss-n small { font-weight: 400; color: var(--muted, #667); }
.ss-bar { height: 10px; margin-top: 8px; border-radius: 999px; background: color-mix(in srgb, var(--fg, #111) 10%, transparent); overflow: hidden; }
.ss-bar i { display: block; height: 100%; border-radius: inherit; background: var(--ss, #b8f03a); }
.ss-done { margin-top: 6px; font-size: .85rem; font-weight: 600; }
.ss-edit { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: .88rem; color: var(--muted, #667); }
.ss-edit input { width: 90px; min-height: 36px; padding: 4px 8px; border: 1px solid var(--line, #ccd); border-radius: 8px; background: transparent; color: var(--fg, #111); font: inherit; font-size: 16px; }
.ss-off { color: var(--muted, #667); font-size: .9rem; }
.ss-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ss-stats div { padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, var(--ss, #b8f03a) 18%, transparent); }
.ss-stats b { display: block; font-size: 1.5rem; font-variant-numeric: tabular-nums; }
.ss-stats span { font-size: .85rem; }
.ss-note { margin: 10px 0 0; font-size: .84rem; color: var(--muted, #667); }
.ss-acts { display: flex; gap: 8px; margin-top: 14px; }
.ss-acts button { flex: 1; min-height: 44px; border-radius: 999px; border: 1px solid var(--line, #ccd); background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.ss-acts button.go { background: var(--fg, #111); color: var(--bg, #fff); border-color: var(--fg, #111); }
.ss-prev { display: block; width: 100%; margin-top: 12px; border-radius: 12px; border: 1px solid var(--line, #ccd); }`;
  document.head.appendChild(css);

  let dlg = null, sp = "mtb", back = 0, editing = false;
  const icon = (name, size = 18) => (window.tfLineName ? window.tfLineName(name, size) : "");
  const monthName = (m) => new Date(2026, m, 15).toLocaleDateString(LOC, { month: "long" });
  const fmt = (n) => Number(n || 0).toLocaleString(LOC);

  function paint() {
    if (!dlg) return;
    const S = SPORTS[sp], s = seasonOf(sp, back), n = count(sp, s), goals = goalsOf(sp);
    dlg.style.setProperty("--ss", S.color);
    const goalHtml = goals.map((g) => {
      if (editing) return `<div class="ss-goal"><div class="ss-row"><b>${esc(g.words)}</b></div><label class="ss-edit"><span>Goal</span> <input type="number" inputmode="numeric" min="0" max="99999" step="1" value="${g.target}" data-goal="${g.id}"> <span>0 turns it off</span></label></div>`;
      if (!g.target) return `<div class="ss-goal"><div class="ss-row"><b>${esc(g.words)}</b><span class="ss-off">Off</span></div></div>`;
      const v = n[g.id] || 0, pct = Math.min(100, Math.round((100 * v) / g.target));
      return `<div class="ss-goal"><div class="ss-row"><b>${esc(g.words)}</b><span class="ss-n" translate="no">${fmt(v)} <small>/ ${fmt(g.target)}</small></span></div><div class="ss-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${g.target}" aria-valuenow="${v}"><i style="width:${pct}%"></i></div>${v >= g.target ? `<p class="ss-done">Goal reached</p>` : ""}</div>`;
    }).join("");
    const stats = S.recap.map(([id, words]) => `<div><b translate="no">${fmt(n[id])}</b><span>${esc(words)}</span></div>`).join("");
    const how = sp === "mtb" ? "A trail counts as new to you the first time one of your saved rides covers it, or you mark it Ridden."
      : sp === "fish" ? "From the catches you saved in the fishing log, by the date of each catch."
      : sp === "ski" ? "From the ski tours you recorded or imported. Goals count days only."
      : sp === "hunt" ? "From the hunts you tracked, kept on this device and on your account when signed in."
      : sp === "hike" ? "From the hikes you recorded or imported." : "From the rides you recorded or imported.";
    dlg.innerHTML = `<div class="ss-head"><span class="ss-ic" aria-hidden="true">${icon(S.icon, 20)}</span><h2><span>${esc(S.name)}</span> <span translate="no">${esc(s.label)}</span></h2><button type="button" class="ss-x" data-ss="close" aria-label="Close">✕</button></div>
<div class="ss-body">
  <div class="ss-seg" role="group" aria-label="Season"><button type="button" data-back="0" aria-pressed="${back === 0}">This season</button><button type="button" data-back="1" aria-pressed="${back === 1}">Last season</button></div>
  <div class="ss-sec">Goals</div>
  ${back ? `<p class="ss-note">Goals are for this season. Here is what you did last season.</p>` : goalHtml}
  ${back ? "" : `<div class="ss-acts"><button type="button" data-ss="edit">${editing ? "Done" : "Change goals"}</button></div>`}
  <div class="ss-sec">Season recap</div>
  <div class="ss-stats">${stats}</div>
  ${n.month >= 0 ? `<p class="ss-note"><span>Busiest month</span>${COLON}<span translate="no">${esc(monthName(n.month))}</span></p>` : ""}
  <p class="ss-note">${esc(how)}</p>
  ${S.private ? `<p class="ss-note">Hunting recaps stay private: there is no Share button.</p>` : `<p class="ss-note">The picture shows numbers only: no map, trail names or places.</p>
  <div class="ss-acts"${S.recap.some(([id]) => n[id] > 0) ? "" : " hidden"}><button type="button" class="go" data-ss="share">${icon("share", 18)}<span>Share recap</span></button></div>`}
</div>`;
    dlg.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => { back = +b.dataset.back; editing = false; paint(); }));
    dlg.querySelector('[data-ss="close"]').addEventListener("click", () => dlg.close());
    const ed = dlg.querySelector('[data-ss="edit"]');
    if (ed) ed.addEventListener("click", () => { editing = !editing; paint(); if (!editing) refreshLine(); });
    dlg.querySelectorAll("[data-goal]").forEach((i) => i.addEventListener("change", () => setGoal(sp, i.dataset.goal, i.value)));
    const sh = dlg.querySelector('[data-ss="share"]');
    if (sh) sh.addEventListener("click", () => share(sh));
  }

  // A goal reached this season counts as a happy moment for the app's rating ask (rate.js, once per goal and season),
  // after this sheet closes: rate.js waits while any dialog is open, so the two never show together.
  function cheer() {
    if (!window.tfHappy) return;
    const s = seasonOf(sp), n = count(sp, s), seen = store.get("seasonCheered", []);
    const fresh = goalsOf(sp).filter((g) => g.target > 0 && (n[g.id] || 0) >= g.target).map((g) => `${sp}:${g.id}:${s.label}`).filter((k) => !seen.includes(k));
    if (!fresh.length) return;
    try { localStorage.setItem("tf:seasonCheered", JSON.stringify([...seen, ...fresh].slice(-60))); } catch {}
    window.tfHappy("season goal");
  }
  async function open(sport) {
    sp = SPORTS[sport] ? sport : sportNow();
    back = 0; editing = false;
    if (!dlg) { dlg = document.createElement("dialog"); dlg.className = "ss-dlg"; document.body.appendChild(dlg); dlg.addEventListener("close", () => { editing = false; refreshLine(); cheer(); }); }
    await load(true);
    paint();
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.show(); } }
  }

  // ---------- the recap picture (1080 × 1350, numbers only) ----------
  function svgImage(name, color) {
    return new Promise((resolve) => {
      const s = icon(name, 96);
      if (!s) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img); img.onerror = () => resolve(null);
      const svg = s.replace(/currentColor/g, color).replace("<svg", s.includes("xmlns") ? "<svg" : '<svg xmlns="http://www.w3.org/2000/svg"');
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }
  async function picture() {
    const S = SPORTS[sp], s = seasonOf(sp, back), n = count(sp, s), goals = back ? [] : goalsOf(sp).filter((g) => g.target > 0);
    const W = 1080, H = 1350, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d"), F = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    g.fillStyle = "#10201a"; g.fillRect(0, 0, W, H);
    g.fillStyle = S.color; g.fillRect(0, 0, W, 14);
    const ic = await svgImage(S.icon, S.color);
    if (ic) g.drawImage(ic, 80, 90, 96, 96);
    g.fillStyle = "#cfd8d3"; g.font = `600 34px ${F}`; g.textBaseline = "alphabetic";
    g.fillText("Trail Finder", 200, 128);
    g.fillStyle = "#ffffff"; g.font = `800 64px ${F}`;
    g.fillText(T(S.name), 80, 290);
    g.fillStyle = S.color; g.font = `800 64px ${F}`;
    g.fillText(s.label, 80, 370);
    // 2 × 2 numbers
    const cells = S.recap.slice(0, 4);
    cells.forEach(([id, words], i) => {
      const x = 80 + (i % 2) * 470, y = 470 + Math.floor(i / 2) * 230;
      g.fillStyle = "rgba(255,255,255,.07)"; roundRect(g, x, y, 450, 200, 28); g.fill();
      g.fillStyle = "#ffffff"; g.font = `800 88px ${F}`; g.fillText(fmt(n[id]), x + 34, y + 104);
      g.fillStyle = "#cfd8d3"; g.font = `500 32px ${F}`;
      wrap(g, T(words), 390).forEach((l, k, all) => g.fillText(l, x + 34, y + (all.length > 1 ? 148 : 162) + k * 36));
    });
    let y = 470 + Math.ceil(cells.length / 2) * 230 + 30;
    goals.slice(0, 2).forEach((gl) => {
      const v = n[gl.id] || 0, pct = Math.min(1, v / gl.target);
      g.fillStyle = "#ffffff"; g.font = `600 34px ${F}`;
      g.fillText(fit(g, `${T("Goal")}${COLON}${T(gl.words)}`, 700), 80, y + 34);
      g.textAlign = "right"; g.fillText(`${fmt(v)} / ${fmt(gl.target)}`, W - 80, y + 34); g.textAlign = "left";
      g.fillStyle = "rgba(255,255,255,.12)"; roundRect(g, 80, y + 54, W - 160, 22, 11); g.fill();
      if (pct > 0) { g.fillStyle = S.color; roundRect(g, 80, y + 54, Math.max(22, (W - 160) * pct), 22, 11); g.fill(); }
      y += 110;
    });
    g.fillStyle = "#8fa39a"; g.font = `500 30px ${F}`;
    g.fillText("trailfinderapp.ca", 80, H - 70);
    return c;
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  // Up to two lines, the second cut with … if it's still too long.
  function wrap(g, t, max) {
    if (g.measureText(t).width <= max) return [t];
    const w = t.split(" "); let a = "";
    for (let i = 0; i < w.length; i++) { const b = a ? a + " " + w[i] : w[i]; if (a && g.measureText(b).width > max) return [a, fit(g, w.slice(i).join(" "), max)]; a = b; }
    return [fit(g, t, max)];
  }
  function fit(g, t, max) { let s = t; while (s.length > 3 && g.measureText(s).width > max) s = s.slice(0, -2); return s === t ? t : s.trimEnd() + "…"; }
  function shareText() {
    const S = SPORTS[sp], s = seasonOf(sp, back), n = count(sp, s);
    return `${T(S.name)} ${s.label}${COLON}${S.recap.slice(0, 3).map(([id, words]) => `${fmt(n[id])} ${T(words).toLowerCase()}`).join(", ")}. trailfinderapp.ca`;
  }
  async function share(btn) {
    if (SPORTS[sp].private) return;
    btn.disabled = true;
    try {
      const c = await picture();
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const file = blob && typeof File === "function" ? new File([blob], `trail-finder-season-${seasonOf(sp, back).label}.png`, { type: "image/png" }) : null;
      const text = shareText();
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text }).catch(() => {});
      } else if (blob) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = file ? file.name : "trail-finder-season.png";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } finally { btn.disabled = false; }
  }

  window.tfSeason = {
    open, picture,
    line: (sport) => lines[SPORTS[sport] ? sport : sportNow()] || "",
    seasonOf, count: (sport, b = 0) => count(sport, seasonOf(sport, b)), load,
  };
})();
