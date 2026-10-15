// New-trail notifications: a 🔔 in the header with the number of unread new trails in the regions the rider picked
// (or all regions). Tapping it opens the notification box; tapping a trail there opens it on the map.
// The list comes from data/new-trails.json, which the nightly job adds to (scripts/build-new-trails.mjs).
// The regions and what's been read are settings (tf:notify, tf:notifyRead), so account.js saves them to the
// rider's account when signed in; guests keep them on this device.
// index.html provides window.tfZones, window.tfClassify (same trail types as the map) and window.tfShowFound.
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
dialog.notify li:not(.unread) strong { font-weight: 500; }`;
  document.head.appendChild(css);

  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "linkish notify-btn";
  slot.appendChild(btn);

  const box = document.createElement("dialog");
  box.className = "notify";
  box.innerHTML = `
<h2>New trails</h2>
<div id="ntPick" hidden>
  <p>Get a notification here for every new trail mapped in the regions you pick.</p>
  <div class="nt-zones" id="ntZones"></div>
  <div class="nt-row"><button type="button" data-close>Not now</button><button type="button" class="go" id="ntSave">Save</button></div>
</div>
<div id="ntList" hidden>
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
      // Only trails the map would show: MTB tagged or looks like MTB, not hiking-only.
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
    const p = prefs(); if (!p) return [];
    const read = readSet();
    return mine().filter((it) => !read.has(keyOf(it)));
  }
  function markRead(keys) {
    const read = store.get("notifyRead", []).filter((k) => !keys.includes(k)).concat(keys);
    store.set("notifyRead", read.slice(-800));
    paint();
  }

  // ---------- painting ----------
  function paint() {
    const n = prefs() ? unread().length : 0;
    btn.innerHTML = `<span aria-hidden="true">🔔</span>${n ? `<span class="nt-count">${n > 99 ? "99+" : n}</span>` : ""}`;
    btn.title = prefs() ? (n ? `${n} new trail${n > 1 ? "s" : ""}` : "No new trails") : "Get notified about new trails";
    btn.setAttribute("aria-label", btn.title);
    if (box.open && !q("ntList").hidden) paintList();
  }
  function paintPick() {
    const p = prefs(), on = new Set(p ? p.zones : ["all"]);
    q("ntZones").innerHTML = [["all", "All regions"], ...ZONES.map((z) => [z.id, z.name])]
      .map(([id, name]) => `<label><input type="checkbox" value="${id}"${on.has(id) ? " checked" : ""}>${esc(name)}</label>`).join("");
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
    if (!zones.length) { try { localStorage.removeItem("tf:notify"); } catch {} window.dispatchEvent(new Event("tf:setting")); box.close(); paint(); return; }
    const p = prefs();
    store.set("notify", { zones, since: p ? p.since : new Date().toISOString() });
    showList(); paint();
  });
  q("ntEdit").addEventListener("click", paintPick);
  q("ntAll").addEventListener("click", () => markRead(unread().map(keyOf)));

  function paintList() {
    const p = prefs(), items = mine(), fresh = new Set(unread().map(keyOf));
    const from = new Date(cutoff(p)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    q("ntWhere").textContent = `${p.zones.includes("all") ? "All regions" : p.zones.map(zoneName).join(", ")} · new since ${visit && visit > p.since ? "your last visit" : "you turned this on"} (${from})`;
    q("ntAll").hidden = !fresh.size;
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
    prefs() ? showList() : paintPick();
    if (!box.open) box.showModal();
  });

  paint();
  load();
  // Pick up the next night's trails on a page left open, and settings pulled from the rider's account.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - fetchedAt > 3 * 3600e3) load(); });
  window.addEventListener("storage", (e) => { if (/^tf:notify/.test(e.key || "")) paint(); });
})();
