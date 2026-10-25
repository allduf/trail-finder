// New-trail notifications: a 🔔 in the header with the number of unread new trails in the regions the rider picked
// (or all regions). Tapping it opens the notification box; tapping a trail there opens it on the map.
// The list comes from data/new-trails.json, which the nightly job adds to (scripts/build-new-trails.mjs).
// The regions and what's been read are settings (tf:notify, tf:notifyRead), so account.js saves them to the
// rider's account when signed in; guests keep them on this device.
// index.html provides window.tfZones, window.tfClassify (same trail types as the map) and window.tfShowFound.
// Two switches (alex): tf:loamArea, trails in the picked regions (and on the To ride list) in prime loam right now
// (Loam index 40-59, damp), and tf:notifyNew, new trails mapped in the picked regions.
// Loam alerts: region trails come from the All trails lists (window.tfZoneTrails) grouped by riding area
// (data/riding-areas.json), To ride trails from window.tfToRideList (any region). An area or trail alerts once each
// time it turns prime; it can alert again after it dries out or gets too wet. The Loam index comes from
// window.tfLoamAt (index.html, Open-Meteo).
// Phone notifications (Web Push): a third switch saves this phone's push address and the settings above to Supabase
// (push_save(), supabase/push.sql); scripts/push-loam.mjs sends the same alerts a few times a day. Device only: tf:pushId.
// Fresh stocking (Fishing): tf:fishAlert = { c: [lat, lon], since } on, the lakes and rivers within FISH_KM of that spot
// (where the map was when it was saved) stocked in the last FISH_DAYS days, from data/fishing/stocked.json (nightly).
(() => {
  const APP_V = ((document.currentScript && document.currentScript.src.match(/[?&]v=(\d+)/)) || [])[1] || "?";   // the job logs it per phone
  const ZONES = window.tfZones, slot = document.querySelector("[data-notify-slot]");
  if (!ZONES || !slot || !window.tfClassify || !window.tfShowFound) return;

  const DAY = 86400000;
  const SAME_VISIT_MS = 3600e3;   // a reload or return within an hour is still the same visit
  const LABEL = { mtb: "MTB tagged", looks: "Likely MTB" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("tf:" + k, JSON.stringify(v)); window.dispatchEvent(new Event("tf:setting")); } catch {} },
  };
  // { zones: ["all"] or zone ids, since: ISO date the rider turned it on }; null until they pick
  const prefs = () => store.get("notify", null);
  const readSet = () => new Set(store.get("notifyRead", []));
  const keyOf = (it) => String(it.ids[0]);
  const zoneName = (id) => { const z = ZONES.find((z) => z.id === id); return z ? z.name : ""; };
  // The bell lists only trails that appeared since the rider's last visit (alex): older ones never show.
  // tf:notifyVisit = { at: last time the app was open, prev: when the visit before that ended }. Kept on this device
  // only: saving it to the account on every visit would make each device's settings look newest.
  const putVisit = (v) => { try { localStorage.setItem("tf:notifyVisit", JSON.stringify(v)); } catch {} };
  const visit = (() => {
    const v = store.get("notifyVisit", null), now = Date.now();
    const prev = !v ? null : now - Date.parse(v.at) < SAME_VISIT_MS ? v.prev : v.at;
    putVisit({ at: new Date(now).toISOString(), prev });
    return prev;
  })();
  const stampVisit = () => putVisit({ at: new Date().toISOString(), prev: visit });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stampVisit(); });
  // New = appeared after the last visit and after notifications were turned on.
  const cutoff = (p) => (visit && visit > p.since ? visit : p.since);
  const ago = (iso) => { const d = Math.floor((Date.now() - Date.parse(iso)) / DAY); return d < 1 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };

  const css = document.createElement("style");
  css.textContent = `
.notify-btn.notify-btn { position: relative; display: inline-flex; align-items: center; gap: 4px; }
.notify-btn .nt-count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #e5484d; color: #fff; font-size: .72rem; font-weight: 700; line-height: 18px; text-align: center; box-sizing: border-box; }
dialog.notify, dialog.notify * { box-sizing: border-box; }
dialog.notify { overflow-x: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 18px; width: min(420px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 48px)); box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.notify::backdrop { background: rgba(0,0,0,.4); }
dialog.notify h2 { margin: 0 0 6px; font-family: var(--font-display); font-size: 1.35rem; text-transform: uppercase; letter-spacing: .02em; }
dialog.notify p { margin: 0 0 10px; color: var(--muted); font-size: .9rem; }
dialog.notify button { font: inherit; cursor: pointer; }
dialog.notify .nt-row { display: flex; gap: 8px; justify-content: space-between; align-items: center; flex-wrap: wrap; margin: 10px 0 0; }
dialog.notify .nt-row button { font-weight: 600; min-height: 42px; padding: 8px 13px; border-radius: 9px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); }
dialog.notify .nt-row button.go { background: var(--accent); color: var(--accent-fg, #fff); border-color: transparent; }
dialog.notify .nt-link { background: none; border: 0; padding: 2px 0; color: var(--accent); font-weight: 600; }
dialog.notify .nt-zones { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 6px; }
dialog.notify .nt-zones label { display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; border-radius: 999px; background: var(--chip); font-size: .86rem; cursor: pointer; }
dialog.notify .nt-zones label:has(input:checked) { background: var(--accent); color: var(--accent-fg, #fff); }
dialog.notify .nt-zones input { margin: 0; accent-color: var(--accent); }
dialog.notify ol { list-style: none; margin: 0; padding: 0; }
dialog.notify li button { display: block; width: 100%; text-align: left; padding: 10px 10px 10px 22px; border: 0; border-bottom: 1px solid var(--line); background: none; color: var(--fg); position: relative; }
dialog.notify li button strong { display: block; }
dialog.notify li button small { color: var(--muted); font-size: .8rem; }
dialog.notify li.unread button::before { content: ""; position: absolute; left: 6px; top: 16px; width: 8px; height: 8px; border-radius: 50%; background: #e5484d; }
dialog.notify li:not(.unread) strong { font-weight: 500; }
dialog.notify h3 { margin: 4px 0 2px; font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
dialog.notify h3 + p { margin-bottom: 4px; }
dialog.notify .nt-loam li.unread button::before { background: var(--prime, #2f8f88); }
dialog.notify .nt-loam .lv { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--fg); }
dialog.notify .nt-loam .lv i { width: 8px; height: 8px; border-radius: 50%; background: var(--prime, #2f8f88); display: inline-block; }
dialog.notify .nt-loam .lv.soon i { background: transparent; box-shadow: inset 0 0 0 2px var(--prime, #2f8f88); }
dialog.notify .nt-opt { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; font-size: .9rem; cursor: pointer; }
dialog.notify .nt-opt input { margin: 0; accent-color: var(--accent); }
dialog.notify .nt-zhead { margin: 14px 0 6px; }
dialog.notify .nt-push { margin: 10px 0 0; padding: 8px 10px; border-radius: 10px; background: var(--chip); }
dialog.notify .nt-push .nt-opt { margin: 0; font-weight: 600; }
dialog.notify .nt-push p { margin: 4px 0 0; font-size: .82rem; }
dialog.notify .nt-push p:empty { display: none; }
dialog.notify .nt-opt:has(input:disabled) { opacity: .6; cursor: default; }
dialog.notify details summary { list-style: none; cursor: pointer; padding: 10px 10px 10px 22px; border-bottom: 1px solid var(--line); position: relative; }
dialog.notify details summary::-webkit-details-marker { display: none; }
dialog.notify details summary strong { display: block; }
dialog.notify details summary small { color: var(--muted); font-size: .8rem; }
dialog.notify details summary::after { content: "▸"; position: absolute; right: 10px; top: 14px; color: var(--muted); }
dialog.notify details[open] summary::after { content: "▾"; }
dialog.notify .nt-avy li.unread button::before { background: #e8590c; }
dialog.notify .nt-fish li.unread button::before { background: #0c8599; }
dialog.notify .nt-avy .lv i { background: var(--c); }
dialog.notify .nt-loam li.unread summary::before { content: ""; position: absolute; left: 6px; top: 16px; width: 8px; height: 8px; border-radius: 50%; background: var(--prime, #2f8f88); }
dialog.notify details ol li button { padding-left: 34px; }
dialog.notify .nt-x { position: absolute; top: 8px; right: 8px; width: 40px; height: 40px; border: 0; border-radius: 50%; background: none; color: var(--muted); font-size: 1.1rem; }
dialog.notify h2 { padding-right: 36px; }
/* Save / Done stay in reach under the long region list */
dialog.notify .nt-row { position: sticky; bottom: -18px; z-index: 1; margin: 10px -18px -18px; padding: 10px 18px 18px; background: var(--panel); box-shadow: 0 -1px 0 var(--line); }`;
  document.head.appendChild(css);

  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "linkish notify-btn";
  slot.appendChild(btn);

  const box = document.createElement("dialog");
  box.className = "notify";
  box.innerHTML = `
<h2>Notifications</h2>
<div id="ntPick" hidden>
  <label class="nt-opt"><input type="checkbox" id="ntLoamArea">Tell me when trails in my regions or on my To ride list are in prime loam</label>
  <label class="nt-opt"><input type="checkbox" id="ntNewOn">Tell me when a new trail is mapped in my regions</label>
  <label class="nt-opt"><input type="checkbox" id="ntAvyOn">⚠ Tell me when the avalanche danger goes up in my regions or on ski tours I watch</label>
  <label class="nt-opt"><input type="checkbox" id="ntFishOn">🎣 Tell me when a lake or river near me is stocked with fish <small id="ntFishWhere"></small></label>
  <div class="nt-push"><label class="nt-opt"><input type="checkbox" id="ntPushOn">📱 Also send them to this phone as notifications</label><p id="ntPushMsg"></p></div>
  <p class="nt-zhead">My regions:</p>
  <div class="nt-zones" id="ntZones"></div>
  <div class="nt-row"><button type="button" data-close>Not now</button><button type="button" class="go" id="ntSave">Save</button></div>
</div>
<div id="ntList" hidden>
  <div id="ntAvy" class="nt-loam nt-avy" hidden><h3>Avalanche danger</h3><p id="ntAvyWhere"></p><ol id="ntAvyItems"></ol></div>
  <div id="ntFish" class="nt-loam nt-fish" hidden><h3>Fresh stocking</h3><p id="ntFishText"></p><ol id="ntFishItems"></ol></div>
  <div id="ntLoam" class="nt-loam" hidden><h3>Prime loam, now and soon</h3><p id="ntLoamWhere"></p><ol id="ntLoamItems"></ol><h3 id="ntNewHead">New trails</h3></div>
  <p id="ntWhere"></p>
  <ol id="ntItems"></ol>
  <div class="nt-row"><button type="button" class="nt-link" id="ntEdit">Change regions</button><span><button type="button" id="ntAll">Mark all read</button> <button type="button" class="go" data-close>Done</button></span></div>
</div>
<button type="button" class="nt-x" data-close aria-label="Close">✕</button>`;
  document.body.appendChild(box);
  const q = (id) => box.querySelector("#" + id);
  box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => box.close()));
  box.addEventListener("click", (e) => { if (e.target === box) box.close(); });

  // ---------- the feed ----------
  let feed = [], fetchedAt = 0;
  async function load() {
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      const r = await fetch("data/new-trails.json", { cache: "no-cache" });
      const f = r.ok ? await r.json() : null;
      if (!f || f.v !== 1) return;
      // Only trails the map would show: MTB tagged or looks like MTB, not hiking-only (scripts/push-loam.mjs does the same).
      feed = f.items.map((it) => ({ ...it, c: window.tfClassify(it.tags || {}, it.routes || [], it.routes && it.routes.length ? ["mtb"] : []) }))
        .filter((it) => it.c && LABEL[it.c.cat] && it.c.use !== "hike");
      fetchedAt = Date.now();
      paint();
    } catch {}
  }
  function mine() {
    const p = prefs(); if (!p) return [];
    const all = p.zones.includes("all"), from = cutoff(p);
    return feed.filter((it) => it.at > from && (all || p.zones.includes(it.z)));
  }
  function unread() {
    const p = prefs(); if (!p || !newOn()) return [];
    const read = readSet();
    return mine().filter((it) => !read.has(keyOf(it)));
  }
  function markRead(keys) {
    const read = store.get("notifyRead", []).filter((k) => !keys.includes(k)).concat(keys);
    store.set("notifyRead", read.slice(-800));
    paint();
  }

  // ---------- loam alerts ----------
  const LOAM_FRESH_MS = 30 * 60000;
  const AREA_KM = 10;   // a region trail belongs to the nearest riding area within 10 km (as in scripts/push-loam.mjs)
  // Before alex's two switches there were tf:loamNew (new trails) and tf:loamRide (To ride list): either one on keeps it on.
  const oldLoam = () => [store.get("loamNew", store.get("loamAlert", true)), store.get("loamRide", store.get("loamAlert", true))].some((v) => v !== false);
  const loamOn = () => store.get("loamArea", oldLoam()) !== false;
  const newOn = () => store.get("notifyNew", true) !== false;
  const isPrime = (v) => v != null && v >= 40 && v < 60;
  // tf:loamAlerts = { key: { p: prime when last checked, r: read since it turned prime } }. Device only, like the visit.
  // Keys: a To ride trail's key, or "a:<riding area>" for an area of the picked regions.
  let alertState = (() => { try { return JSON.parse(localStorage.getItem("tf:loamAlerts") || "{}") || {}; } catch { return {}; } })();
  const putAlerts = () => { try { localStorage.setItem("tf:loamAlerts", JSON.stringify(alertState)); } catch {} };
  let loamList = [], loamAt = 0, loamBusy = false, loamAgain = false;   // in prime loam now: To ride trails { key, name, type, ids, kind, c, v, why } and areas { key, name, area: true, trails, why }
  const rideList = () => (window.tfToRideList && loamOn() ? window.tfToRideList() : []).map((t) => ({ ...t, why: "On your To ride list" }));
  // The picked regions' zones. "All regions" means every zone's file, so only zones the page has already loaded.
  const regionZones = () => { const p = prefs(); return !p || !loamOn() ? [] : p.zones.includes("all") ? ZONES.map((z) => ({ id: z.id, loaded: true })) : p.zones.map((id) => ({ id })); };
  let areasP = null;
  const ridingAreas = () => areasP || (areasP = fetch("data/riding-areas.json").then((r) => r.json()).then((f) => f.areas || []).catch(() => { areasP = null; return []; }));
  const kmTo = (a, b) => Math.hypot((a[1] - b[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180), (a[0] - b[0]) * 110.57);
  async function regionTrails() {
    const zs = regionZones();
    if (!zs.length || !window.tfZoneTrails) return [];
    const [areas, lists] = await Promise.all([ridingAreas(), Promise.all(zs.map((z) => window.tfZoneTrails(z.id, z.loaded).catch(() => [])))]);
    return lists.flatMap((ts, i) => ts.map((t) => {
      let best = null, d = AREA_KM;
      areas.forEach((a) => { const k = kmTo(t.c, a.c); if (k < d) { d = k; best = a.name; } });
      return { ...t, area: best || `Other trails in ${zoneName(zs[i].id)}` };
    }));
  }
  // Something to watch at all: To ride trails, or regions picked.
  const watching = () => loamOn() && (rideList().length > 0 || regionZones().length > 0);
  async function checkLoam(force) {
    if (!loamOn() || !window.tfLoamAt || (!force && Date.now() - loamAt < LOAM_FRESH_MS)) return;
    if (loamBusy) { loamAgain = true; return; }
    loamBusy = true;
    try {
      const ride = rideList(), region = await regionTrails();
      if (!ride.length && !region.length) { loamList = []; loamAt = Date.now(); throw null; }
      const pts = ride.map((t) => t.c).concat(region.map((t) => t.c));
      const vals = await window.tfLoamAt(pts);
      // Loam forecast: the first coming day each spot turns prime (same readings, nothing more to download).
      const soon = window.tfLoamSoon ? await window.tfLoamSoon(pts).catch(() => pts.map(() => null)) : pts.map(() => null);
      // Snow on the ground (same readings): the soil under snow can read prime, but it isn't.
      const snow = window.tfSnowAt ? await window.tfSnowAt(pts).catch(() => pts.map(() => null)) : pts.map(() => null);
      const primeAt = (i) => isPrime(vals[i]) && !(snow[i] >= (window.tfSnowCm || 5));
      const now = [], areas = new Map(), seen = new Set();
      const mark = (key, prime) => { const was = alertState[key]; if (prime) { if (!was || !was.p) alertState[key] = { p: 1, r: 0 }; } else if (was) alertState[key] = { p: 0, r: 1 }; };
      ride.forEach((t, i) => {
        const v = vals[i];
        if (v == null) { seen.add(t.key); return; }   // no soil data: leave its state alone
        seen.add(t.key);
        if (primeAt(i)) now.push({ ...t, v });
        mark(t.key, primeAt(i));
        const s = !primeAt(i) && soon[i];
        seen.add("s:" + t.key);
        if (s) now.push({ ...t, key: "s:" + t.key, v: s.v, soon: s, why: "On your To ride list" });
        mark("s:" + t.key, !!s);
      });
      region.forEach((t, i) => {
        const v = vals[ride.length + i], key = "a:" + t.area;
        seen.add(key);
        if (!areas.has(key)) areas.set(key, { key, name: t.area, area: true, trails: [], soonTrails: [], known: false });
        if (v == null) return;
        const a = areas.get(key);
        a.known = true;
        if (primeAt(ride.length + i)) a.trails.push({ ...t, v });
        else if (soon[ride.length + i]) a.soonTrails.push({ ...t, v: soon[ride.length + i].v, soon: soon[ride.length + i] });
      });
      areas.forEach((a) => {
        if (!a.known) return;
        // Nothing prime now but some trails will be: one "prime loam <day>" line for the area, earliest day first.
        const sk = "s:" + a.key, first = a.trails.length ? null : a.soonTrails.map((t) => t.soon).sort((x, y) => x.d.localeCompare(y.d))[0];
        seen.add(sk);
        mark(sk, !!first);
        if (first) {
          const ts = a.soonTrails.filter((t) => t.soon.d === first.d).sort((x, y) => x.name.localeCompare(y.name)), vs = ts.map((t) => t.v);
          now.push({ key: sk, name: a.name, area: true, soon: first, trails: ts,
            why: `Prime loam ${first.day} · ${ts.length} trail${ts.length > 1 ? "s" : ""} · Loam ${Math.min(...vs) === Math.max(...vs) ? vs[0] : `${Math.min(...vs)} to ${Math.max(...vs)}`}` });
        }
        mark(a.key, a.trails.length > 0);
        if (!a.trails.length) return;
        const vs = a.trails.map((t) => t.v), lo = Math.min(...vs), hi = Math.max(...vs);
        a.trails.sort((x, y) => x.name.localeCompare(y.name));
        a.why = `${a.trails.length} trail${a.trails.length > 1 ? "s" : ""} · Loam ${lo === hi ? lo : `${lo} to ${hi}`}`;
        now.push(a);
      });
      // Forget trails and areas no longer watched, so the list doesn't grow forever.
      Object.keys(alertState).forEach((k) => { if (!seen.has(k)) delete alertState[k]; });
      putAlerts();
      // Unread first, prime now before prime soon, To ride trails before areas, bigger areas first.
      const rank = (t) => alertState[t.key].r * 4 + (t.soon ? 2 : 0) + (t.area ? 1 : 0);
      loamList = now.sort((a, b) => rank(a) - rank(b) || (b.trails || []).length - (a.trails || []).length || a.name.localeCompare(b.name));
      loamAt = Date.now();
    } catch {}
    loamBusy = false;
    paint();
    if (loamAgain) { loamAgain = false; checkLoam(true); }
  }
  const loamUnread = () => (loamOn() ? loamList.filter((t) => alertState[t.key] && !alertState[t.key].r) : []);
  function markLoamRead(keys) {
    keys.forEach((k) => { if (alertState[k]) alertState[k].r = 1; });
    putAlerts();
    paint();
  }

  // ---------- avalanche alerts (Skiing) ----------
  // tf:avyAlert on: the Avalanche Canada forecast areas over the picked regions, when their highest rating for today or
  // tomorrow goes up to Considerable or more, and the ski tours watched with 🔔 Watch this tour (tf:skiWatch, winter.js),
  // when their trip planner light (ski-terrain.js) goes to Extra caution or Not recommended. Each alerts once each
  // time it goes up; again after it comes back down. From data/avalanche.json (every 2 hours); scripts/push-loam.mjs
  // sends the same to phones. tf:avyAlerts = { key: { lv: level when last checked, r: read } }, device only.
  const TT = window.tfTerrain;
  const DANGER = ["No rating", "Low", "Moderate", "Considerable", "High", "Extreme"];
  const DANGER_C = ["#9aa3ad", "#52ba4a", "#fff300", "#f79218", "#ef1c29", "#1a1a1a"];
  const avyOn = () => store.get("avyAlert", false) === true;
  const skiWatch = () => store.get("skiWatch", []);
  let avyState = (() => { try { return JSON.parse(localStorage.getItem("tf:avyAlerts") || "{}") || {}; } catch { return {}; } })();
  const putAvy = () => { try { localStorage.setItem("tf:avyAlerts", JSON.stringify(avyState)); } catch {} };
  let avyList = [], avyAt = 0;
  const ringBox = (a) => { let s = 90, w = 180, n = -90, e = -180; (a.rings || []).forEach((r) => { for (let i = 0; i < r.length; i += 2) { s = Math.min(s, r[i]); n = Math.max(n, r[i]); w = Math.min(w, r[i + 1]); e = Math.max(e, r[i + 1]); } }); return [s, w, n, e]; };
  async function checkAvy(force) {
    if (!avyOn() || !TT || (!force && Date.now() - avyAt < LOAM_FRESH_MS)) return;
    try {
      const d = await fetch("data/avalanche.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null));
      if (!d || !d.areas) throw null;
      const today = new Date().toLocaleDateString("en-CA"), now = [], seen = new Set();
      const live = (f) => f && f.days && !(f.validUntil && new Date(f.validUntil) < new Date());
      const soon = (f) => f.days.filter((x) => x.date >= today).slice(0, 2);   // today and tomorrow
      const dayWord = (x) => (x.date === today ? "today" : x.label || x.date);
      const mark = (key, lv) => { seen.add(key); const was = avyState[key]; if (!was || lv > was.lv) avyState[key] = { lv, r: 0 }; else was.lv = lv; };
      const p = prefs(), zones = !p ? [] : p.zones.includes("all") ? ZONES : ZONES.filter((z) => p.zones.includes(z.id));
      for (const a of d.areas) {
        const f = a.forecast, b = ringBox(a);
        if (!live(f) || !zones.some((z) => z.box[0] <= b[2] && z.box[2] >= b[0] && z.box[1] <= b[3] && z.box[3] >= b[1])) continue;
        let best = null;
        for (const x of soon(f)) { const r = Math.max(x.alp || 0, x.tln || 0, x.btl || 0); if (!best || r > best.r) best = { r, x }; }
        const key = "v:" + a.id;
        if (!best || best.r < 3) { if (avyState[key]) { avyState[key] = { lv: best ? best.r : 0, r: 1 }; seen.add(key); } continue; }
        mark(key, best.r);
        now.push({ key, name: f.title || a.name, lv: best.r, color: DANGER_C[best.r], label: `${DANGER[best.r]} ${dayWord(best.x)}`, why: "In your regions", c: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] });
      }
      for (const t of skiWatch()) {
        const a = t.c && TT.areaAt(d.areas, t.c[0], t.c[1]), f = a && a.forecast, key = "t:" + t.k;
        if (!live(f)) continue;
        let best = null;
        for (const x of soon(f)) { const dg = TT.dangerIn(x, TT.bandsFor(a.name), t.lo, t.hi), l = TT.light(dg.r, t.cls); if (l >= 0 && (!best || l > best.l)) best = { l, x, dg }; }
        if (!best || best.l < 1) { if (avyState[key]) { avyState[key] = { lv: best ? best.l : 0, r: 1 }; seen.add(key); } continue; }
        mark(key, best.l);
        const L = TT.LIGHTS[best.l];
        now.push({ key, name: t.n, k: t.k, lv: best.l, color: L.color, label: `${L.label} ${dayWord(best.x)}`, why: `Tour you watch · ${DANGER[best.dg.r]} in the ${{ alp: "alpine", tln: "treeline", btl: "below treeline" }[best.dg.band]}`, c: t.c });
      }
      Object.keys(avyState).forEach((k) => { if (!seen.has(k)) delete avyState[k]; });
      putAvy();
      avyList = now.sort((x, y) => avyState[x.key].r - avyState[y.key].r || y.lv - x.lv);
      avyAt = Date.now();
    } catch {}
    paint();
  }
  const avyUnread = () => (avyOn() ? avyList.filter((t) => avyState[t.key] && !avyState[t.key].r) : []);
  function markAvyRead(keys) { keys.forEach((k) => { if (avyState[k]) avyState[k].r = 1; }); putAvy(); paint(); }
  function paintAvy() {
    q("ntAvy").hidden = !avyOn();
    if (!avyOn()) return;
    const fresh = new Set(avyUnread().map((t) => t.key)), n = skiWatch().length;
    q("ntAvyWhere").textContent = `Avalanche Canada's forecast, today and tomorrow: Considerable or more ${prefs() ? "in your regions" : "(pick regions to watch them)"}${n ? `, and Extra caution or Not recommended on the ${n} tour${n > 1 ? "s" : ""} you watch` : ". Watch a tour with 🔔 in its details in Skiing"}.`;
    q("ntAvyItems").innerHTML = avyList.length ? avyList.map((t, i) => `<li class="${fresh.has(t.key) ? "unread" : ""}"><button type="button" data-v="${i}"><strong>${esc(t.name)}</strong>
      <small><span class="lv" style="--c:${t.color}"><i></i>${esc(t.label)}</span> · ${esc(t.why)}</small></button></li>`).join("")
      : `<li><p>${avyAt ? "No raised danger in what you watch right now." : "Checking the avalanche forecast…"}</p></li>`;
    q("ntAvyItems").querySelectorAll("button[data-v]").forEach((b) => b.addEventListener("click", () => {
      const t = avyList[+b.dataset.v];
      markAvyRead([t.key]);
      box.close();
      if (window.tfSki && window.tfSki.show) window.tfSki.show(t.k, t.c);
    }));
  }

  // ---------- fresh stocking (Fishing) ----------
  const FISH_KM = 50, FISH_DAYS = 21;
  const fishPref = () => store.get("fishAlert", null), fishOn = () => !!(fishPref() && fishPref().c);
  let fishState = (() => { try { return JSON.parse(localStorage.getItem("tf:fishAlerts") || "{}") || {}; } catch { return {}; } })();
  const putFish = () => { try { localStorage.setItem("tf:fishAlerts", JSON.stringify(fishState)); } catch {} };
  let fishList = [], fishAt = 0;
  async function checkFish(force) {
    if (!fishOn() || (!force && Date.now() - fishAt < LOAM_FRESH_MS)) return;
    try {
      const d = await fetch("data/fishing/stocked.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null));
      if (!d || !d.waters) throw null;
      const p = fishPref(), from = new Date(Math.max(Date.now() - FISH_DAYS * DAY, Date.parse(p.since || 0) - 14 * DAY)).toISOString().slice(0, 10), now = [], seen = new Set();
      for (const w of d.waters) {
        if (Math.abs(w.c[0] - p.c[0]) > 0.6 || Math.abs(w.c[1] - p.c[1]) > 1) continue;
        const km = kmTo(p.c, w.c); if (km > FISH_KM) continue;
        const fresh = w.r.filter((r) => /^\d{4}-\d\d-\d\d$/.test(r[0]) && r[0] >= from);
        if (!fresh.length) continue;
        const key = `k:${w.id || w.n}:${fresh[0][0]}`;
        seen.add(key); if (!fishState[key]) fishState[key] = { r: 0 };
        const fish = [...new Set(fresh.filter((r) => r[0] === fresh[0][0]).map((r) => `${r[2] ? r[2].toLocaleString() + " " : ""}${(d.sp[r[1]] || "fish").toLowerCase()}`))].join(", ");
        now.push({ key, name: w.n, day: fresh[0][0], c: w.c, km, label: `${new Date(fresh[0][0] + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${fish}` });
      }
      Object.keys(fishState).forEach((k) => { if (!seen.has(k)) delete fishState[k]; });
      putFish();
      fishList = now.sort((x, y) => fishState[x.key].r - fishState[y.key].r || y.day.localeCompare(x.day) || x.km - y.km);
      fishAt = Date.now();
    } catch {}
    paint();
  }
  const fishUnread = () => (fishOn() ? fishList.filter((t) => fishState[t.key] && !fishState[t.key].r) : []);
  function markFishRead(keys) { keys.forEach((k) => { if (fishState[k]) fishState[k].r = 1; }); putFish(); paint(); }
  function paintFish() {
    q("ntFish").hidden = !fishOn();
    if (!fishOn()) return;
    const fresh = new Set(fishUnread().map((t) => t.key));
    q("ntFishText").textContent = `Lakes and rivers within ${FISH_KM} km of the spot you picked, stocked in the last 3 weeks (BC, Alberta and Ontario stocking reports).`;
    q("ntFishItems").innerHTML = fishList.length ? fishList.map((t, i) => `<li class="${fresh.has(t.key) ? "unread" : ""}"><button type="button" data-f="${i}"><strong>${esc(t.name)}</strong>
      <small>${esc(t.label)} · ${Math.round(t.km)} km away</small></button></li>`).join("")
      : `<li><p>${fishAt ? "Nothing stocked near you in the last 3 weeks. You'll see it here the morning after the report comes out." : "Checking the stocking reports…"}</p></li>`;
    q("ntFishItems").querySelectorAll("button[data-f]").forEach((b) => b.addEventListener("click", () => {
      const t = fishList[+b.dataset.f];
      markFishRead([t.key]);
      box.close();
      if (window.tfFish && window.tfFish.show) window.tfFish.show(t.c[0], t.c[1], t.name);
    }));
  }
  const fishWhere = () => { const m = window.tfLeaflet; return m ? [Math.round(m.getCenter().lat * 100) / 100, Math.round(m.getCenter().lng * 100) / 100] : null; };

  // ---------- painting ----------
  function paint() {
    const nNew = prefs() ? unread().length : 0, nLoam = loamUnread().length, nAvy = avyUnread().length, nFish = fishUnread().length, n = nNew + nLoam + nAvy + nFish;
    btn.innerHTML = `<span aria-hidden="true">🔔</span>${n ? `<span class="nt-count">${n > 99 ? "99+" : n}</span>` : ""}`;
    const parts = [nFish && `${nFish} fresh stocking${nFish > 1 ? "s" : ""}`, nAvy && `${nAvy} avalanche alert${nAvy > 1 ? "s" : ""}`, nNew && `${nNew} new trail${nNew > 1 ? "s" : ""}`, nLoam && `${nLoam} prime loam alert${nLoam > 1 ? "s" : ""}`].filter(Boolean);
    btn.title = parts.length ? parts.join(", ") : prefs() ? "No new trails" : "Get notified about new trails and prime loam";
    btn.setAttribute("aria-label", btn.title);
    if (box.open && !q("ntList").hidden) paintList();
  }
  function paintPick() {
    const p = prefs(), on = new Set(p ? p.zones : ["all"]);
    q("ntZones").innerHTML = [["all", "All regions"], ...ZONES.map((z) => [z.id, z.name])]
      .map(([id, name]) => `<label><input type="checkbox" value="${id}"${on.has(id) ? " checked" : ""}>${esc(name)}</label>`).join("");
    q("ntLoamArea").checked = loamOn();
    q("ntNewOn").checked = newOn();
    q("ntAvyOn").checked = avyOn();
    q("ntFishOn").checked = fishOn();
    q("ntFishWhere").textContent = fishOn() ? `(within ${FISH_KM} km of the spot you picked; saving again moves it to where the map is now)` : `(within ${FISH_KM} km of where the map is now)`;
    q("ntPick").hidden = false; q("ntList").hidden = true;
    paintPush();
  }
  // "All regions" and single regions don't mix.
  q("ntZones").addEventListener("change", (e) => {
    const all = q("ntZones").querySelector('input[value="all"]');
    if (e.target === all && all.checked) q("ntZones").querySelectorAll("input:not([value=all])").forEach((i) => { i.checked = false; });
    else if (e.target !== all && e.target.checked) all.checked = false;
  });
  q("ntSave").addEventListener("click", () => {
    const zones = [...q("ntZones").querySelectorAll("input:checked")].map((i) => i.value);
    store.set("loamArea", q("ntLoamArea").checked);
    store.set("notifyNew", q("ntNewOn").checked);
    store.set("avyAlert", q("ntAvyOn").checked);
    if (!q("ntFishOn").checked) store.set("fishAlert", null);
    else { const c = fishWhere(), f = fishPref(); if (c) store.set("fishAlert", { c, since: f ? f.since : new Date().toISOString() }); }
    if (!zones.length) { try { localStorage.removeItem("tf:notify"); } catch {} window.dispatchEvent(new Event("tf:setting")); }
    else { const p = prefs(); store.set("notify", { zones, since: p ? p.since : new Date().toISOString() }); }
    checkLoam(true); checkAvy(true); checkFish(true);
    pushSync(0, true);   // right away (on iPhone the app is often put away straight after Save), even if nothing looks changed
    if (zones.length || watching() || (avyOn() && skiWatch().length) || fishOn()) showList(); else box.close();
    paint();
  });
  q("ntEdit").addEventListener("click", paintPick);
  q("ntAll").addEventListener("click", () => { markFishRead(fishUnread().map((t) => t.key)); markAvyRead(avyUnread().map((t) => t.key)); markLoamRead(loamUnread().map((t) => t.key)); markRead(unread().map(keyOf)); });

  function paintLoam() {
    q("ntLoam").hidden = !loamOn();
    if (!loamOn()) return;
    const fresh = new Set(loamUnread().map((t) => t.key)), items = loamList;
    const what = [prefs() && "the trails in your regions", "your To ride trails"].filter(Boolean);
    q("ntLoamWhere").textContent = `Damp hero dirt (Loam index 40 to 59) on ${what.join(" and ")}, now and in the next 3 days.`;
    const trailBtn = (t, data) => `<button type="button" ${data}><strong>${esc(t.name)}</strong>
      <small><span class="lv${t.soon ? " soon" : ""}"><i></i>Loam ${t.v}${t.soon ? ` ${esc(t.soon.day)}` : ""}</span>${t.why ? ` · ${esc(t.why)}` : t.kind ? ` · ${esc(t.kind)}` : ""}</small></button>`;
    q("ntLoamItems").innerHTML = items.length ? items.map((t, i) => `<li class="${fresh.has(t.key) ? "unread" : ""}">${t.area
      ? `<details data-a="${i}"><summary><strong>${esc(t.name)}</strong><small><span class="lv${t.soon ? " soon" : ""}"><i></i>${esc(t.why)}</span></small></summary>
        <ol>${t.trails.map((x, j) => `<li>${trailBtn(x, `data-l="${i}" data-j="${j}"`)}</li>`).join("")}</ol></details>`
      : trailBtn(t, `data-l="${i}"`)}</li>`).join("")
      : `<li><p>${loamBusy || (!loamAt && watching()) ? "Checking the loam…" : watching() ? "Nothing is in prime loam now or in the next 3 days. You'll see trails here when they are." : "Pick regions, or add trails to your To ride list (☆ To ride in a trail's details), to hear when they're in prime loam."}</p></li>`;
    q("ntLoamItems").querySelectorAll("details[data-a]").forEach((d) => d.addEventListener("toggle", () => {
      if (d.open) { const t = items[+d.dataset.a]; if (alertState[t.key] && !alertState[t.key].r) { alertState[t.key].r = 1; putAlerts(); d.parentNode.classList.remove("unread"); paint(); } }
    }));
    q("ntLoamItems").querySelectorAll("button[data-l]").forEach((b) => b.addEventListener("click", () => {
      const a = items[+b.dataset.l], t = b.dataset.j == null ? a : a.trails[+b.dataset.j];
      markLoamRead([a.key]);
      box.close();
      // center: the spot the Loam index was read at, so the trail's details show the same number.
      window.tfShowFound({ type: t.type || "w", items: t.ids.map((id) => ({ id })), name: t.name, kind: t.kind, center: window.L && t.c ? window.L.latLng(t.c[0], t.c[1]) : undefined });
    }));
  }
  function paintList() {
    paintFish();
    paintAvy();
    paintLoam();
    const p = prefs();
    q("ntEdit").textContent = p ? "Change regions" : "Pick regions";
    q("ntAll").hidden = !unread().length && !loamUnread().length && !avyUnread().length && !fishUnread().length;
    if (!newOn()) {
      q("ntWhere").textContent = "New trail notifications are off.";
      q("ntItems").innerHTML = "";
      return;
    }
    if (!p) {
      q("ntWhere").textContent = "Pick regions to hear about every new trail mapped there.";
      q("ntItems").innerHTML = "";
      return;
    }
    const items = mine(), fresh = new Set(unread().map(keyOf));
    const from = new Date(cutoff(p)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    q("ntWhere").textContent = `${p.zones.includes("all") ? "All regions" : p.zones.map(zoneName).join(", ")} · new since ${visit && visit > p.since ? "your last visit" : "you turned this on"} (${from})`;
    q("ntItems").innerHTML = items.length ? items.map((it, i) => `<li class="${fresh.has(keyOf(it)) ? "unread" : ""}"><button type="button" data-i="${i}">
      <strong>${esc(it.name || "Unnamed trail")}</strong>
      <small>${esc(LABEL[it.c.cat])} · ${esc(zoneName(it.z))} · mapped ${ago(it.ft || it.at)}${it.u ? ` by ${esc(it.u)}` : ""}</small></button></li>`).join("")
      : `<li><p>No new trails since ${visit && visit > p.since ? "your last visit" : "you turned this on"}. When someone maps one, it shows up here the next morning.</p></li>`;
    q("ntItems").querySelectorAll("button[data-i]").forEach((b) => b.addEventListener("click", () => {
      const it = items[+b.dataset.i];
      markRead([keyOf(it)]);
      box.close();
      window.tfShowFound({ type: "w", items: it.ids.map((id) => ({ id })), name: it.name || "Unnamed trail", kind: LABEL[it.c.cat] });
    }));
  }
  function showList() { q("ntPick").hidden = true; q("ntList").hidden = false; paintList(); }

  btn.addEventListener("click", () => {
    openBox();
  });
  function openBox() {
    prefs() || (loamOn() && loamList.length) || (avyOn() && skiWatch().length) || fishOn() ? showList() : paintPick();
    if (!box.open) box.showModal();
    checkLoam(); checkAvy(); checkFish();
  }

  paint();
  load();
  // Pick up the next night's trails on a page left open, and settings pulled from the rider's account.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (Date.now() - fetchedAt > 3 * 3600e3) load(); else checkLoam();
    checkAvy(); checkFish();
    pushSync();   // an iPhone app brought back from the background: send a change it didn't get to send before it was put away
  });
  window.addEventListener("storage", (e) => { if (/^tf:(notify|notifyNew|avyAlert|fishAlert|skiWatch|loam(New|Ride|Alert|Area))$/.test(e.key || "")) paint(); });
  // A trail added to (or taken off) the To ride list, or settings pulled from the account: check its loam soon.
  let watchKey = "";
  const rewatch = () => {
    const k = loamOn() + "," + newOn() + "," + avyOn() + "|" + JSON.stringify(prefs()) + "|" + rideList().map((t) => t.key).join(";") + "|" + skiWatch().map((t) => t.k).join(";") + "|" + JSON.stringify(fishPref());
    if (k !== watchKey) { watchKey = k; checkLoam(true); checkAvy(true); checkFish(true); pushSync(); }
  };
  window.addEventListener("tf:setting", () => setTimeout(rewatch, 300));
  window.addEventListener("tf:account", () => setTimeout(rewatch, 1500));
  setTimeout(rewatch, 2000);   // the To ride list, once index.html has it

  // ---------- phone notifications (Web Push) ----------
  // Sent by scripts/push-loam.mjs (.github/workflows/loam-push.yml) from what push_save() stored for this phone.
  // On iPhone, web pages can't get them: only the site added to the Home Screen can (iOS 16.4 or newer).
  const PUSH_TIMES = "about 7 am, 10 am, 1 pm, 4 pm and 7 pm";
  const pushOk = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
  const iPhone = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
  const pushId = () => lsGet("tf:pushId");
  async function rpc(fn, args) {
    const a = window.tfAccount;
    if (!a || !a.url) throw new Error("no server");
    const r = await fetch(`${a.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: a.key, "Content-Type": "application/json" }, body: JSON.stringify(args || {}) });
    if (!r.ok) throw new Error(r.status === 404 ? "setup" : "HTTP " + r.status);
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }
  // The site's public push key, fetched when the box opens: iPhone only allows subscribing right after the tap.
  let pushKey = null;
  const getKey = () => pushKey || (pushKey = rpc("push_key").then((k) => { if (!k) pushKey = null; return k; }, (e) => { pushKey = null; throw e; }));
  const keyBytes = (b64) => { const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - b64.length % 4) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  // What this phone wants, for the job: the same switches and regions as the 🔔, and the To ride trails' spots.
  const pushWatch = () => {
    const p = prefs();
    return { v: APP_V, zones: p ? p.zones : [], since: p ? p.since : null, loam: loamOn(), newt: newOn() && !!p,
      ride: rideList().filter((t) => t.c).map((t) => ({ k: t.key, n: t.name, c: [r5(t.c[0]), r5(t.c[1])] })),
      avy: avyOn(), tours: avyOn() ? skiWatch().map((t) => ({ k: t.k, n: t.n, c: t.c, lo: t.lo, hi: t.hi, cls: t.cls })) : [],
      fish: fishOn() ? { c: fishPref().c, since: fishPref().since } : null };
  };
  const swReady = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error("no service worker")), 8000))]);
  const lastSave = () => { try { return JSON.parse(lsGet("tf:pushSaved") || "{}") || {}; } catch { return {}; } };
  async function pushSave(sub, force) {
    const watch = pushWatch(), body = { p_id: pushId(), p_sub: sub.toJSON(), p_watch: watch };
    const hash = JSON.stringify([sub.endpoint, watch]), last = lastSave();
    if (!force && last.h === hash && Date.now() - last.at < 3 * 86400e3) return;   // nothing new (re-saved every few days anyway)
    await rpc("push_save", body);
    lsSet("tf:pushSaved", JSON.stringify({ h: hash, at: Date.now() }));
  }
  // Keep the job's copy of this phone's settings and To ride list up to date, and renew an expired push address.
  // A failure is kept (tf:pushErr) and shown on the 📱 line, so a phone that stops updating says why.
  let syncT = 0, pushErr = lsGet("tf:pushErr") || "";
  function pushSync(wait = 1500, force = false) {
    if (!pushOk || !pushId()) return;
    clearTimeout(syncT);
    syncT = setTimeout(async () => {
      try {
        if (Notification.permission !== "granted") throw new Error("notifications not allowed");
        const reg = await swReady();
        let sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await getKey()) })
          .catch(() => { throw new Error("the phone dropped its push address: turn 📱 off and on again"); });
        await pushSave(sub, force);
        pushErr = "";
      } catch (e) { pushErr = (e && e.message) || String(e); }
      lsSet("tf:pushErr", pushErr || null);
      if (box.open) paintPush();
    }, wait);
  }
  // What the job will check for this phone, so a phone with nothing picked (the Home Screen app keeps its own
  // settings, apart from Safari's) says so instead of staying quiet.
  function watchingText() {
    const p = prefs(), n = p ? (p.zones.includes("all") ? ZONES.length : p.zones.length) : 0, r = loamOn() ? rideList().length : 0, st = avyOn() ? skiWatch().length : 0;
    if (!n && !r && !st) return "It's watching nothing yet: pick your regions below and tap Save, or sign in to bring them over.";
    const parts = [n && (p.zones.includes("all") ? "all regions" : `${n} region${n > 1 ? "s" : ""}`), r && `${r} To ride trail${r > 1 ? "s" : ""}`, st && `${st} ski tour${st > 1 ? "s" : ""}`].filter(Boolean);
    const what = [loamOn() && "prime loam", newOn() && n && "new trails", avyOn() && "avalanche danger"].filter(Boolean);
    return what.length ? `Watching ${parts.join(", ")} for ${what.join(", ")}.` : "The switches above are off, so it won't send anything.";
  }
  function pushMsg(text) { q("ntPushMsg").textContent = text; }
  function paintPush() {
    const on = q("ntPushOn");
    on.checked = !!pushId() && pushOk && Notification.permission === "granted";
    on.disabled = !pushOk;
    if (!pushOk) return pushMsg(iPhone && !navigator.standalone
      ? "On iPhone, this works from the Home Screen: in Safari tap Share, then Add to Home Screen. Open Trail Finder from that icon and turn this on there."
      : iPhone ? "Phone notifications need iOS 16.4 or newer." : "This browser can't show notifications.");
    if (Notification.permission === "denied") return pushMsg("Notifications are blocked for Trail Finder. Allow them in your phone's settings, then turn this on.");
    const at = lastSave().at, ago = at && Math.round((Date.now() - at) / 60000);
    const sent = !at ? "" : ago < 2 ? " Sent to Trail Finder just now." : ago < 120 ? ` Sent to Trail Finder ${ago} min ago.`
      : ` Last sent to Trail Finder ${new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`;
    pushMsg(!on.checked ? "" : pushErr ? `On for this phone, but your latest changes didn't reach Trail Finder (${pushErr}). Tap Save to try again.`
      : `On for this phone. ${watchingText()}${sent} Checked at ${PUSH_TIMES}.`);
    getKey().catch(() => {});
  }
  q("ntPushOn").addEventListener("change", async (e) => {
    const on = e.target;
    on.disabled = true;
    try {
      if (on.checked) {
        // Ask first, straight from the tap (iPhone requires it), then subscribe.
        const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        if (perm !== "granted") throw new Error(perm === "denied" ? "blocked" : "not allowed");
        const key = await getKey();
        if (!key) throw new Error("setup");
        const reg = await swReady();
        const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
        if (!pushId()) lsSet("tf:pushId", crypto.randomUUID());
        lsSet("tf:pushSaved", null);
        await pushSave(sub);
        reg.showNotification("Phone notifications are on", { body: `Trail Finder checks at ${PUSH_TIMES}.`, icon: "icons/icon-192.png", tag: "tf-on" }).catch(() => {});
      } else {
        const id = pushId();
        lsSet("tf:pushId", null); lsSet("tf:pushSaved", null);
        if (id) await rpc("push_delete", { p_id: id }).catch(() => {});
        const reg = await swReady().catch(() => null), sub = reg && await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe().catch(() => {});
      }
      on.disabled = false;
      paintPush();
    } catch (err) {
      on.checked = false; on.disabled = false;
      lsSet("tf:pushId", null);
      pushMsg(err.message === "blocked" ? "Notifications are blocked for Trail Finder. Allow them in your phone's settings, then try again."
        : err.message === "setup" ? "Phone notifications aren't set up on the site yet. Try again later."
        : err.message === "not allowed" ? "Tap Allow when your phone asks, to get notifications."
        : `Couldn't turn on notifications (${err.message}). Try again in a moment.`);
    }
  });
  // Tapping a notification opens this box: in this window (sw.js sends a message) or a new one (#notify).
  if (pushOk) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.tf === "loam") openBox(); });
  if (location.hash === "#notify" || location.hash === "#loam") { history.replaceState(null, "", location.pathname + location.search); setTimeout(openBox, 600); }
})();
