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
(() => {
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
  <div class="nt-push"><label class="nt-opt"><input type="checkbox" id="ntPushOn">📱 Also send them to this phone as notifications</label><p id="ntPushMsg"></p></div>
  <p class="nt-zhead">My regions:</p>
  <div class="nt-zones" id="ntZones"></div>
  <div class="nt-row"><button type="button" data-close>Not now</button><button type="button" class="go" id="ntSave">Save</button></div>
</div>
<div id="ntList" hidden>
  <div id="ntLoam" class="nt-loam" hidden><h3>Prime loam now</h3><p id="ntLoamWhere"></p><ol id="ntLoamItems"></ol><h3 id="ntNewHead">New trails</h3></div>
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
      const vals = await window.tfLoamAt(ride.map((t) => t.c).concat(region.map((t) => t.c)));
      const now = [], areas = new Map(), seen = new Set();
      const mark = (key, prime) => { const was = alertState[key]; if (prime) { if (!was || !was.p) alertState[key] = { p: 1, r: 0 }; } else if (was) alertState[key] = { p: 0, r: 1 }; };
      ride.forEach((t, i) => {
        const v = vals[i];
        if (v == null) { seen.add(t.key); return; }   // no soil data: leave its state alone
        seen.add(t.key);
        if (isPrime(v)) now.push({ ...t, v });
        mark(t.key, isPrime(v));
      });
      region.forEach((t, i) => {
        const v = vals[ride.length + i], key = "a:" + t.area;
        seen.add(key);
        if (!areas.has(key)) areas.set(key, { key, name: t.area, area: true, trails: [], known: false });
        if (v == null) return;
        const a = areas.get(key);
        a.known = true;
        if (isPrime(v)) a.trails.push({ ...t, v });
      });
      areas.forEach((a) => {
        if (!a.known) return;
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
      // Unread first, To ride trails before areas, bigger areas first.
      const rank = (t) => alertState[t.key].r * 2 + (t.area ? 1 : 0);
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

  // ---------- painting ----------
  function paint() {
    const nNew = prefs() ? unread().length : 0, nLoam = loamUnread().length, n = nNew + nLoam;
    btn.innerHTML = `<span aria-hidden="true">🔔</span>${n ? `<span class="nt-count">${n > 99 ? "99+" : n}</span>` : ""}`;
    const parts = [nNew && `${nNew} new trail${nNew > 1 ? "s" : ""}`, nLoam && `${nLoam} prime loam alert${nLoam > 1 ? "s" : ""}`].filter(Boolean);
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
    if (!zones.length) { try { localStorage.removeItem("tf:notify"); } catch {} window.dispatchEvent(new Event("tf:setting")); }
    else { const p = prefs(); store.set("notify", { zones, since: p ? p.since : new Date().toISOString() }); }
    checkLoam(true);
    pushSync();
    if (zones.length || watching()) showList(); else box.close();
    paint();
  });
  q("ntEdit").addEventListener("click", paintPick);
  q("ntAll").addEventListener("click", () => { markLoamRead(loamUnread().map((t) => t.key)); markRead(unread().map(keyOf)); });

  function paintLoam() {
    q("ntLoam").hidden = !loamOn();
    if (!loamOn()) return;
    const fresh = new Set(loamUnread().map((t) => t.key)), items = loamList;
    const what = [prefs() && "the trails in your regions", "your To ride trails"].filter(Boolean);
    q("ntLoamWhere").textContent = `Damp hero dirt (Loam index 40 to 59) on ${what.join(" and ")}.`;
    const trailBtn = (t, data) => `<button type="button" ${data}><strong>${esc(t.name)}</strong>
      <small><span class="lv"><i></i>Loam ${t.v}</span>${t.why ? ` · ${esc(t.why)}` : t.kind ? ` · ${esc(t.kind)}` : ""}</small></button>`;
    q("ntLoamItems").innerHTML = items.length ? items.map((t, i) => `<li class="${fresh.has(t.key) ? "unread" : ""}">${t.area
      ? `<details data-a="${i}"><summary><strong>${esc(t.name)}</strong><small><span class="lv"><i></i>${esc(t.why)}</span></small></summary>
        <ol>${t.trails.map((x, j) => `<li>${trailBtn(x, `data-l="${i}" data-j="${j}"`)}</li>`).join("")}</ol></details>`
      : trailBtn(t, `data-l="${i}"`)}</li>`).join("")
      : `<li><p>${loamBusy || (!loamAt && watching()) ? "Checking the loam…" : watching() ? "Nothing is in prime loam right now. You'll see trails here when they are." : "Pick regions, or add trails to your To ride list (☆ To ride in a trail's details), to hear when they're in prime loam."}</p></li>`;
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
    paintLoam();
    const p = prefs();
    q("ntEdit").textContent = p ? "Change regions" : "Pick regions";
    q("ntAll").hidden = !unread().length && !loamUnread().length;
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
    prefs() || (loamOn() && loamList.length) ? showList() : paintPick();
    if (!box.open) box.showModal();
    checkLoam();
  }

  paint();
  load();
  // Pick up the next night's trails on a page left open, and settings pulled from the rider's account.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (Date.now() - fetchedAt > 3 * 3600e3) load(); else checkLoam();
  });
  window.addEventListener("storage", (e) => { if (/^tf:(notify|notifyNew|loam(New|Ride|Alert|Area))$/.test(e.key || "")) paint(); });
  // A trail added to (or taken off) the To ride list, or settings pulled from the account: check its loam soon.
  let watchKey = "";
  const rewatch = () => {
    const k = loamOn() + "," + newOn() + "|" + JSON.stringify(prefs()) + "|" + rideList().map((t) => t.key).join(";");
    if (k !== watchKey) { watchKey = k; checkLoam(true); pushSync(); }
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
    return { zones: p ? p.zones : [], since: p ? p.since : null, loam: loamOn(), newt: newOn() && !!p,
      ride: rideList().filter((t) => t.c).map((t) => ({ k: t.key, n: t.name, c: [r5(t.c[0]), r5(t.c[1])] })) };
  };
  const swReady = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error("no service worker")), 8000))]);
  async function pushSave(sub) {
    const watch = pushWatch(), body = { p_id: pushId(), p_sub: sub.toJSON(), p_watch: watch };
    const hash = JSON.stringify([sub.endpoint, watch]), last = JSON.parse(lsGet("tf:pushSaved") || "{}");
    if (last.h === hash && Date.now() - last.at < 3 * 86400e3) return;   // nothing new (re-saved every few days anyway)
    await rpc("push_save", body);
    lsSet("tf:pushSaved", JSON.stringify({ h: hash, at: Date.now() }));
  }
  // Keep the job's copy of this phone's settings and To ride list up to date, and renew an expired push address.
  let syncT = 0;
  function pushSync() {
    if (!pushOk || !pushId() || Notification.permission !== "granted") return;
    clearTimeout(syncT);
    syncT = setTimeout(async () => {
      try {
        const reg = await swReady();
        let sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await getKey()) });
        await pushSave(sub);
      } catch {}
    }, 1500);
  }
  // What the job will check for this phone, so a phone with nothing picked (the Home Screen app keeps its own
  // settings, apart from Safari's) says so instead of staying quiet.
  function watchingText() {
    const p = prefs(), n = p ? (p.zones.includes("all") ? ZONES.length : p.zones.length) : 0, r = loamOn() ? rideList().length : 0;
    if (!n && !r) return "It's watching nothing yet: pick your regions below and tap Save, or sign in to bring them over.";
    const parts = [n && (p.zones.includes("all") ? "all regions" : `${n} region${n > 1 ? "s" : ""}`), r && `${r} To ride trail${r > 1 ? "s" : ""}`].filter(Boolean);
    return `Watching ${parts.join(" and ")}.`;
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
    pushMsg(on.checked ? `On for this phone. ${watchingText()} Checked at ${PUSH_TIMES}.` : "");
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
