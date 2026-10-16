// New-trail notifications: a 🔔 in the header with the number of unread new trails in the regions the rider picked
// (or all regions). Tapping it opens the notification box; tapping a trail there opens it on the map.
// The list comes from data/new-trails.json, which the nightly job adds to (scripts/build-new-trails.mjs).
// The regions and what's been read are settings (tf:notify, tf:notifyRead), so account.js saves them to the
// rider's account when signed in; guests keep them on this device.
// index.html provides window.tfZones, window.tfClassify (same trail types as the map) and window.tfShowFound.
// Loam alerts: the bell also lists trails that are in prime loam right now (Loam index 40-59, damp): new trails from
// the last 30 days in the picked regions, and every trail on the rider's To ride list (window.tfToRideList, any
// region). A trail alerts once each time it turns prime; it can alert again after it dries out or gets too wet.
// The Loam index comes from window.tfLoamAt (index.html, Open-Meteo). Two switches: tf:loamNew (new trails) and tf:loamRide (To ride list).
(() => {
  const ZONES = window.tfZones, slot = document.querySelector("[data-notify-slot]");
  if (!ZONES || !slot || !window.tfClassify || !window.tfShowFound) return;

  const DAY = 86400000;
  const SAME_VISIT_MS = 3600e3;   // a reload or return within an hour is still the same visit
  const LABEL = { mtb: "MTB tagged", looks: "Looks like MTB" };
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
dialog.notify .nt-row button { font-weight: 600; padding: 8px 13px; border-radius: 9px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); }
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
dialog.notify .nt-opt input { margin: 0; accent-color: var(--accent); }`;
  document.head.appendChild(css);

  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "linkish notify-btn";
  slot.appendChild(btn);

  const box = document.createElement("dialog");
  box.className = "notify";
  box.innerHTML = `
<h2>Notifications</h2>
<div id="ntPick" hidden>
  <p>Get a notification here for every new trail mapped in the regions you pick.</p>
  <div class="nt-zones" id="ntZones"></div>
  <label class="nt-opt"><input type="checkbox" id="ntLoamNew">Tell me when a new trail is in prime loam</label>
  <label class="nt-opt"><input type="checkbox" id="ntLoamRide">Tell me when a trail on my To ride list is in prime loam</label>
  <div class="nt-row"><button type="button" data-close>Not now</button><button type="button" class="go" id="ntSave">Save</button></div>
</div>
<div id="ntList" hidden>
  <div id="ntLoam" class="nt-loam" hidden><h3>Prime loam now</h3><p id="ntLoamWhere"></p><ol id="ntLoamItems"></ol><h3 id="ntNewHead">New trails</h3></div>
  <p id="ntWhere"></p>
  <ol id="ntItems"></ol>
  <div class="nt-row"><button type="button" class="nt-link" id="ntEdit">Change regions</button><span><button type="button" id="ntAll">Mark all read</button> <button type="button" class="go" data-close>Done</button></span></div>
</div>`;
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
      // pt: the trail's spot (the file's "c"), kept for loam alerts. Only trails the map would show: MTB tagged or looks like MTB, not hiking-only.
      feed = f.items.map((it) => ({ ...it, pt: it.c, c: window.tfClassify(it.tags || {}, it.routes || [], it.routes && it.routes.length ? ["mtb"] : []) }))
        .filter((it) => it.c && LABEL[it.c.cat] && it.c.use !== "hike");
      fetchedAt = Date.now();
      paint();
      checkLoam(true);
    } catch {}
  }
  function mine() {
    const p = prefs(); if (!p) return [];
    const all = p.zones.includes("all"), from = cutoff(p);
    return feed.filter((it) => it.at > from && (all || p.zones.includes(it.z)));
  }
  function unread() {
    const p = prefs(); if (!p) return [];
    const read = readSet();
    return mine().filter((it) => !read.has(keyOf(it)));
  }
  function markRead(keys) {
    const read = store.get("notifyRead", []).filter((k) => !keys.includes(k)).concat(keys);
    store.set("notifyRead", read.slice(-800));
    paint();
  }

  // ---------- loam alerts ----------
  const LOAM_DAYS = 30;           // a trail counts as new for loam alerts for its first month
  const LOAM_FRESH_MS = 30 * 60000;
  // Both on unless turned off (or turned off with the single switch that came before them, tf:loamAlert).
  const loamNewOn = () => store.get("loamNew", store.get("loamAlert", true)) !== false;
  const loamRideOn = () => store.get("loamRide", store.get("loamAlert", true)) !== false;
  const loamOn = () => loamNewOn() || loamRideOn();
  const isPrime = (v) => v != null && v >= 40 && v < 60;
  const trailKey = (type, ids) => (type || "w")[0] + ids.slice().sort((a, b) => a - b).join(",");
  // tf:loamAlerts = { key: { p: prime when last checked, r: read since it turned prime } }. Device only, like the visit.
  let alertState = (() => { try { return JSON.parse(localStorage.getItem("tf:loamAlerts") || "{}") || {}; } catch { return {}; } })();
  const putAlerts = () => { try { localStorage.setItem("tf:loamAlerts", JSON.stringify(alertState)); } catch {} };
  let loamList = [], loamAt = 0, loamBusy = false, loamAgain = false;   // trails in prime loam now: { key, name, type, ids, kind, v, why }
  function watched() {
    const out = new Map(), p = prefs();
    (window.tfToRideList && loamRideOn() ? window.tfToRideList() : []).forEach((t) => out.set(t.key, { ...t, why: "On your To ride list" }));
    if (p && loamNewOn()) {
      const all = p.zones.includes("all"), from = new Date(Date.now() - LOAM_DAYS * DAY).toISOString();
      feed.filter((it) => it.pt && it.at > from && (all || p.zones.includes(it.z))).forEach((it) => {
        const key = trailKey("w", it.ids);
        if (!out.has(key)) out.set(key, { key, name: it.name || "Unnamed trail", type: "w", ids: it.ids, kind: LABEL[it.c.cat], c: it.pt, why: `New trail · ${zoneName(it.z)}` });
      });
    }
    return [...out.values()];
  }
  async function checkLoam(force) {
    if (!loamOn() || !window.tfLoamAt || (!force && Date.now() - loamAt < LOAM_FRESH_MS)) return;
    if (loamBusy) { loamAgain = true; return; }
    const list = watched();
    if (!list.length) { loamList = []; paint(); return; }
    loamBusy = true;
    try {
      const vals = await window.tfLoamAt(list.map((t) => t.c));
      const now = [];
      list.forEach((t, i) => {
        const v = vals[i], was = alertState[t.key];
        if (v == null) return;   // no soil data: leave its state alone
        if (isPrime(v)) { now.push({ ...t, v }); if (!was || !was.p) alertState[t.key] = { p: 1, r: 0 }; }
        else if (was) alertState[t.key] = { p: 0, r: 1 };
      });
      // Forget trails no longer watched, so the list doesn't grow forever.
      const keep = new Set(list.map((t) => t.key));
      // Not before the new-trails file is in, or its trails would alert again once it is.
      if (fetchedAt) Object.keys(alertState).forEach((k) => { if (!keep.has(k)) delete alertState[k]; });
      putAlerts();
      // Unread first, To ride and named trails before unnamed ones.
      const rank = (t) => alertState[t.key].r * 4 + (t.why[0] === "O" ? 0 : 1) + (t.name === "Unnamed trail" ? 2 : 0);
      loamList = now.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
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
    const parts = [nNew && `${nNew} new trail${nNew > 1 ? "s" : ""}`, nLoam && `${nLoam} trail${nLoam > 1 ? "s" : ""} in prime loam`].filter(Boolean);
    btn.title = parts.length ? parts.join(", ") : prefs() ? "No new trails" : "Get notified about new trails and prime loam";
    btn.setAttribute("aria-label", btn.title);
    if (box.open && !q("ntList").hidden) paintList();
  }
  function paintPick() {
    const p = prefs(), on = new Set(p ? p.zones : ["all"]);
    q("ntZones").innerHTML = [["all", "All regions"], ...ZONES.map((z) => [z.id, z.name])]
      .map(([id, name]) => `<label><input type="checkbox" value="${id}"${on.has(id) ? " checked" : ""}>${esc(name)}</label>`).join("");
    q("ntLoamNew").checked = loamNewOn();
    q("ntLoamRide").checked = loamRideOn();
    q("ntPick").hidden = false; q("ntList").hidden = true;
  }
  // "All regions" and single regions don't mix.
  q("ntZones").addEventListener("change", (e) => {
    const all = q("ntZones").querySelector('input[value="all"]');
    if (e.target === all && all.checked) q("ntZones").querySelectorAll("input:not([value=all])").forEach((i) => { i.checked = false; });
    else if (e.target !== all && e.target.checked) all.checked = false;
  });
  q("ntSave").addEventListener("click", () => {
    const zones = [...q("ntZones").querySelectorAll("input:checked")].map((i) => i.value);
    store.set("loamNew", q("ntLoamNew").checked);
    store.set("loamRide", q("ntLoamRide").checked);
    if (!zones.length) { try { localStorage.removeItem("tf:notify"); } catch {} window.dispatchEvent(new Event("tf:setting")); }
    else { const p = prefs(); store.set("notify", { zones, since: p ? p.since : new Date().toISOString() }); }
    checkLoam(true);
    if (zones.length || (loamOn() && watched().length)) showList(); else box.close();
    paint();
  });
  q("ntEdit").addEventListener("click", paintPick);
  q("ntAll").addEventListener("click", () => { markLoamRead(loamUnread().map((t) => t.key)); markRead(unread().map(keyOf)); });

  function paintLoam() {
    q("ntLoam").hidden = !loamOn();
    if (!loamOn()) return;
    const fresh = new Set(loamUnread().map((t) => t.key)), items = loamList;
    const what = [loamRideOn() && "your To ride trails", loamNewOn() && prefs() && "the new trails of the last month"].filter(Boolean);
    q("ntLoamWhere").textContent = `Damp hero dirt (Loam index 40 to 59) on ${what.join(" and ") || "new trails in the regions you pick"}.`;
    q("ntLoamItems").innerHTML = items.length ? items.map((t, i) => `<li class="${fresh.has(t.key) ? "unread" : ""}"><button type="button" data-l="${i}">
      <strong>${esc(t.name)}</strong>
      <small><span class="lv"><i></i>Loam ${t.v}</span> · ${esc(t.why)}</small></button></li>`).join("")
      : `<li><p>${loamBusy || (!loamAt && watched().length) ? "Checking the loam…" : watched().length ? "None of them are in prime loam right now. You'll see them here when they are." : loamRideOn() ? "Add trails to your To ride list (☆ To ride in a trail's details) to hear when they're in prime loam." : "Pick regions to hear when their new trails are in prime loam."}</p></li>`;
    q("ntLoamItems").querySelectorAll("button[data-l]").forEach((b) => b.addEventListener("click", () => {
      const t = items[+b.dataset.l];
      markLoamRead([t.key]);
      box.close();
      window.tfShowFound({ type: t.type || "w", items: t.ids.map((id) => ({ id })), name: t.name, kind: t.kind });
    }));
  }
  function paintList() {
    paintLoam();
    const p = prefs();
    q("ntEdit").textContent = p ? "Change regions" : "Pick regions";
    q("ntAll").hidden = !unread().length && !loamUnread().length;
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
    prefs() || (loamOn() && loamList.length) ? showList() : paintPick();
    if (!box.open) box.showModal();
    checkLoam();
  });

  paint();
  load();
  // Pick up the next night's trails on a page left open, and settings pulled from the rider's account.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (Date.now() - fetchedAt > 3 * 3600e3) load(); else checkLoam();
  });
  window.addEventListener("storage", (e) => { if (/^tf:(notify|loam(New|Ride|Alert)$)/.test(e.key || "")) paint(); });
  // A trail added to (or taken off) the To ride list, or settings pulled from the account: check its loam soon.
  let watchKey = "";
  const rewatch = () => {
    const k = loamNewOn() + "," + loamRideOn() + "|" + watched().map((t) => t.key).join(";");
    if (k !== watchKey) { watchKey = k; checkLoam(true); }
  };
  window.addEventListener("tf:setting", () => setTimeout(rewatch, 300));
  window.addEventListener("tf:account", () => setTimeout(rewatch, 1500));
  setTimeout(rewatch, 2000);   // the To ride list, before (or without) the new-trails file
})();
