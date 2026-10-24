// Where to ride today (alex, from Trailforks' region status and "discover"): one card that answers "where do I go?".
//  - Go ride: up to 5 trails near you that aren't in your Ridden list and are in prime loam now or in the next 3 days,
//    new trails first (first mapped in the last 6 months), then nearest. It ranks; it never hides anything else.
//  - Riding areas near you: loam now (how many trails are prime, or the day they turn prime), rider reports from the
//    last 7 days (trees down called out), and wildfires or evacuation areas close by. Each area: Trails here, Save offline.
//  - Snow: trails still under snow (Open-Meteo snow depth, tfSnowAt) never count as prime, and an area says so.
//  - Closures and warnings close by (closures.js: Alberta Parks trail reports, BC Parks advisories, Parks Canada).
//  - 🔁 Loops: ready-made loops for the area, with distance, climb and ride time (loops.js), opened in Plan a route.
// Reads the same things as the rest of the app: tfZoneTrails (index.html, the All trails list), tfLoamAt / tfLoamSoon
// (the shared Loam readings), trail_reports (reports.js), data/fires*.json, data/riding-areas.json, data/closures.json.
(() => {
  "use strict";
  const T = window.tfToday, map = window.tfLeaflet;
  if (!T || !map || !window.L || !window.tfZoneTrails) return;
  const NEAR_KM = 40, AREA_KM = 10, FIRE_KM = 25, NEW_DAYS = 183, REPORT_DAYS = 7, GO_MAX = 5;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const kmTo = (a, b) => Math.hypot((a[1] - b[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180), (a[0] - b[0]) * 110.57);
  const isPrime = (v) => v != null && v >= 40 && v < 60;
  const LEVELS = [[20, "Dry", "#d9a35a"], [40, "Tacky", "#5aa86a"], [60, "Prime", "#3f8f8c"], [80, "Wet", "#3b6fb0"], [101, "Saturated", "#33468f"]];
  const level = (v) => LEVELS.find((l) => v < l[0]);
  const dot = (v) => `<i class="td-dot" style="background:${v == null ? "#8a8f98" : level(v)[2]}"></i>`;
  const ago = (t) => { const d = Math.floor((Date.now() - t) / 864e5); return d < 1 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : d < 60 ? "a month ago" : `${Math.round(d / 30)} months ago`; };
  const REPORT = { dry: "☀️ Dry", tacky: "🤎 Tacky, loamy", muddy: "💧 Muddy", trees_down: "🌲 Trees down", snow: "❄️ Snow", closed: "🚧 Closed" };

  const css = document.createElement("style");
  css.textContent = `
dialog.today { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 16px; width: min(520px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); overflow: auto; box-sizing: border-box; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.today::backdrop { background: rgba(0,0,0,.45); }
dialog.today h2 { margin: 0; font-family: var(--font-display); font-size: 1.3rem; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
dialog.today h2 button { font: inherit; border: 0; background: none; color: var(--muted); font-size: 1.2rem; cursor: pointer; padding: 2px 6px; }
dialog.today h3 { margin: 16px 0 6px; font-size: .78rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
dialog.today .td-from { margin: 4px 0 0; color: var(--muted); font-size: .85rem; }
dialog.today ol, dialog.today ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
dialog.today .td-go button { width: 100%; text-align: left; font: inherit; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--line); background: var(--chip, #fff); color: var(--fg); cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
dialog.today .td-go b { font-size: .98rem; }
dialog.today small { color: var(--muted); font-size: .8rem; }
dialog.today .td-new { display: inline-block; font-size: .7rem; font-weight: 800; padding: 1px 7px; border-radius: 999px; background: #b8f03a; color: #10230f; margin-left: 6px; vertical-align: 1px; }
dialog.today .td-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: 0; }
dialog.today .td-area { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
dialog.today .td-area header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
dialog.today .td-area p { margin: 4px 0 0; font-size: .88rem; }
dialog.today .td-warn { color: #b45309; }
dialog.today .td-snow { color: #3f6ea8; }
dialog.today .td-act { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
dialog.today .td-act button { font: inherit; font-size: .82rem; font-weight: 600; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip, #fff); color: var(--fg); cursor: pointer; }
dialog.today .td-wait { color: var(--muted); font-size: .9rem; }
button.btn.today-btn { width: 100%; margin: 4px 0 8px; }`;
  document.head.append(css);

  const dlg = document.createElement("dialog");
  dlg.className = "today";
  dlg.innerHTML = `<h2>Where to ride today <button type="button" data-x aria-label="Close">✕</button></h2><p class="td-from" id="tdFrom"></p>
    <h3>Go ride: new to you, in good dirt</h3><ol class="td-go" id="tdGo"><li class="td-wait">Checking the loam…</li></ol>
    <h3>Riding areas near you</h3><ul id="tdAreas"><li class="td-wait">Loading…</li></ul>`;
  document.body.append(dlg);
  const $ = (id) => document.getElementById(id);
  dlg.querySelector("[data-x]").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  // Entry points: a button above My trails (MTB), and the phone's More menu (index.html, data-act="today").
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "btn today-btn"; btn.id = "todayBtn";
  btn.textContent = "☀ Where to ride today";
  btn.title = "Trails near you in prime loam that you haven't ridden, and each riding area's loam, reports and fires";
  const anchor = $("wantList");
  if (anchor) anchor.before(btn);
  btn.addEventListener("click", () => open());
  window.tfTodayOpen = () => open();

  let areasP = null;
  const ridingAreas = () => areasP || (areasP = fetch("data/riding-areas.json").then((r) => r.json()).then((f) => (f.areas || []).filter((a) => Array.isArray(a.c))).catch(() => { areasP = null; return []; }));
  let firesP = null;
  const fireData = () => firesP || (firesP = Promise.all(["fires.json", "fires-ca.json"].map((f) => T.nightly(f).catch(() => null))).then((fs) => {
    const out = { fires: [], evac: [] };
    fs.forEach((f) => { if (f && f.v === 1) { out.fires.push(...(f.fires || [])); out.evac.push(...(f.evac || [])); } });
    return out;
  }));
  // Your location: the dot on the map if it's there, a quick fix, else the middle of the map.
  function whereFrom() {
    const ll = T.you();
    if (ll) return Promise.resolve({ c: [ll.lat, ll.lng], you: true });
    const mid = () => { const m = T.center(); return { c: [m.lat, m.lng], you: false }; };
    if (!navigator.geolocation) return Promise.resolve(mid());
    return new Promise((ok) => navigator.geolocation.getCurrentPosition((p) => ok({ c: [p.coords.latitude, p.coords.longitude], you: true }), () => ok(mid()), { timeout: 8000, maximumAge: 600000 }));
  }
  // The nearest point of a zone's box, to pick the zones within reach.
  const zoneKm = (z, c) => { const b = z.bounds; return kmTo(c, [Math.max(b.getSouth(), Math.min(b.getNorth(), c[0])), Math.max(b.getWest(), Math.min(b.getEast(), c[1]))]); };

  let token = 0;
  async function open() {
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); } }
    const my = ++token;
    $("tdFrom").textContent = "Finding where you are…";
    $("tdGo").innerHTML = `<li class="td-wait">Checking the loam…</li>`;
    $("tdAreas").innerHTML = `<li class="td-wait">Loading…</li>`;
    const from = await whereFrom();
    if (my !== token) return;
    const zs = T.zones.filter((z) => zoneKm(z, from.c) <= NEAR_KM);
    $("tdFrom").textContent = `${from.you ? "From where you are" : "From the middle of the map (location not shared)"}, within ${NEAR_KM} km.`;
    if (!zs.length) {
      $("tdGo").innerHTML = `<li class="td-wait">No riding areas within ${NEAR_KM} km in the app's regions (Vancouver to Calgary). Move the map to a riding town and try again.</li>`;
      $("tdAreas").innerHTML = "";
      return;
    }
    const [lists, areasAll, born] = await Promise.all([Promise.all(zs.map((z) => window.tfZoneTrails(z.id).catch(() => []))), ridingAreas(), T.firstMappedIn(zs).catch(() => null)]);
    if (my !== token) return;
    const trails = lists.flat().filter((t) => t.c && kmTo(t.c, from.c) <= NEAR_KM).map((t) => ({ ...t, km: kmTo(t.c, from.c) }));
    const areas = areasAll.filter((a) => zs.some((z) => z.id === a.zone) && kmTo(a.c, from.c) <= NEAR_KM + AREA_KM)
      .map((a) => ({ ...a, km: kmTo(a.c, from.c), trails: [] })).sort((a, b) => a.km - b.km);
    trails.forEach((t) => {
      let best = null, d = AREA_KM;
      areas.forEach((a) => { const k = kmTo(t.c, a.c); if (k < d) { d = k; best = a; } });
      t.area = best; if (best) best.trails.push(t);
    });
    const pts = trails.map((t) => t.c);
    const [vals, soon, snow] = await Promise.all([window.tfLoamAt ? window.tfLoamAt(pts).catch(() => pts.map(() => null)) : pts.map(() => null),
      window.tfLoamSoon ? window.tfLoamSoon(pts).catch(() => pts.map(() => null)) : pts.map(() => null),
      window.tfSnowAt ? window.tfSnowAt(pts).catch(() => pts.map(() => null)) : pts.map(() => null)]);
    if (my !== token) return;
    // Snow on the ground (5 cm or more): not prime loam, whatever the soil under it reads.
    trails.forEach((t, i) => { t.snow = snow[i] >= (window.tfSnowCm || 5) ? snow[i] : 0; t.v = vals[i]; t.prime = isPrime(t.v) && !t.snow; t.soon = t.prime ? null : soon[i]; });
    const newSince = Date.now() - NEW_DAYS * 864e5;
    trails.forEach((t) => { const ts = born ? t.ids.map((id) => born.get(id)).filter(Boolean) : []; t.born = ts.length === t.ids.length && ts.length ? Math.min(...ts) : null; t.isNew = !!t.born && t.born >= newSince; });
    renderGo(trails);
    renderAreas(areas);
    addReports(areas, my);
    addFires(areas, my);
    addClosures(areas, my);
  }

  function renderGo(trails) {
    const ridden = T.ridden();
    const pick = trails.filter((t) => !ridden.has(T.nameKey(t.name)) && (t.prime || t.soon))
      .sort((a, b) => (b.prime - a.prime) || (b.isNew - a.isNew) || (a.soon && b.soon ? a.soon.d.localeCompare(b.soon.d) : 0) || a.km - b.km)
      .slice(0, GO_MAX);
    const el = $("tdGo");
    if (!pick.length) {
      const read = trails.some((t) => t.v != null);
      el.innerHTML = `<li class="td-wait">${read ? `No trail you haven't ridden within ${NEAR_KM} km is in prime loam now or in the next 3 days.` : "Couldn't read the loam right now. Try again in a few minutes."}</li>`;
      return;
    }
    el.innerHTML = pick.map((t, i) => `<li><button type="button" data-i="${i}"><b>${esc(t.name)}${t.isNew ? `<span class="td-new">New</span>` : ""}</b>
      <small>${dot(t.prime ? t.v : t.soon.v)}${t.prime ? `Prime now · Loam ${t.v}` : `Prime ${esc(t.soon.day)} · Loam ${t.soon.v}`}${t.area ? ` · ${esc(t.area.name)}` : ""} · ${t.km < 1 ? "under 1" : Math.round(t.km)} km away${t.isNew ? ` · added ${ago(t.born)}` : ""}</small></button></li>`).join("");
    el.querySelectorAll("button[data-i]").forEach((b) => b.addEventListener("click", () => {
      const t = pick[+b.dataset.i];
      dlg.close();
      window.tfShowFound({ type: "w", items: t.ids.map((id) => ({ id })), name: t.name, kind: t.kind, center: L.latLng(t.c[0], t.c[1]) });
    }));
  }

  function renderAreas(areas) {
    const shown = areas.filter((a) => a.trails.length);
    $("tdAreas").innerHTML = !shown.length ? `<li class="td-wait">No riding areas within ${NEAR_KM} km.</li>` : shown.map((a, i) => {
      const read = a.trails.filter((t) => t.v != null), prime = read.filter((t) => t.prime), snowed = a.trails.filter((t) => t.snow);
      const vs = read.map((t) => t.v).sort((x, y) => x - y), mid = vs.length ? vs[Math.floor(vs.length / 2)] : null;
      const soonDay = !prime.length && a.trails.map((t) => t.soon).filter(Boolean).sort((x, y) => x.d.localeCompare(y.d))[0];
      const loam = mid == null ? "Loam not available" : prime.length ? `<b>${prime.length} of ${read.length} trails in prime loam</b> · middle ${mid}`
        : `${level(mid)[1]} · Loam ${mid}${soonDay ? ` · <b>prime ${esc(soonDay.day)}</b>` : ""}`;
      return `<li class="td-area" data-a="${i}"><header><b>${esc(a.name)}</b><small>${Math.round(a.km)} km</small></header>
        <p>${dot(prime.length ? prime[0].v : mid)}${loam}</p><p class="td-close"></p>${snowed.length ? `<p class="td-snow">❄ ${snowed.length === a.trails.length ? "All" : `${snowed.length} of ${a.trails.length}`} trail${a.trails.length > 1 ? "s" : ""} likely under snow (${Math.max(...snowed.map((t) => t.snow))} cm at the most)</p>` : ""}<p class="td-rep"><small>Checking rider reports…</small></p><p class="td-fire"></p>
        <div class="td-act"><button type="button" data-go>Trails here</button>${window.tfLoops ? `<button type="button" data-loops aria-expanded="false">🔁 Loops</button>` : ""}${window.tfOffline ? `<button type="button" data-off>⤓ Save offline</button>` : ""}</div><div class="td-loops" hidden></div></li>`;
    }).join("");
    $("tdAreas").querySelectorAll("[data-a]").forEach((li) => {
      const a = shown[+li.dataset.a];
      a.el = li;
      li.querySelector("[data-go]").addEventListener("click", () => { dlg.close(); map.flyTo(a.c, 13); });
      // Ready-made loops (loops.js), built when asked.
      const lb = li.querySelector("[data-loops]"), lbox = li.querySelector(".td-loops");
      if (lb) lb.addEventListener("click", () => {
        const show = lbox.hidden;
        lbox.hidden = !show; lb.setAttribute("aria-expanded", String(show));
        if (show && !lbox.dataset.done) { lbox.dataset.done = "1"; window.tfLoops.show(lbox, a, () => dlg.close()); }
      });
      const off = li.querySelector("[data-off]");
      if (off) off.addEventListener("click", () => {
        const lat = a.trails.map((t) => t.c[0]), lon = a.trails.map((t) => t.c[1]);
        dlg.close();
        window.tfOffline.saveBox([Math.min(...lat), Math.min(...lon), Math.max(...lat), Math.max(...lon)], a.name);
      });
    });
  }

  // Rider reports from the last week, per area: how many, the latest, trees down.
  async function addReports(areas, my) {
    const acct = window.tfAccount, shown = areas.filter((a) => a.el);
    const say = (a, html) => { const p = a.el && a.el.querySelector(".td-rep"); if (p) p.innerHTML = html; };
    if (!shown.length) return;
    let rows = null;
    try {
      if (acct && acct.enabled) await acct.load();
      if (acct && acct.client) {
        const lat = shown.map((a) => a.c[0]), lon = shown.map((a) => a.c[1]), pad = AREA_KM / 100;
        const { data, error } = await acct.client.from("trail_reports").select("condition, note, created_at, lat, lon, trail_name")
          .gte("created_at", new Date(Date.now() - REPORT_DAYS * 864e5).toISOString())
          .gte("lat", Math.min(...lat) - pad).lte("lat", Math.max(...lat) + pad).gte("lon", Math.min(...lon) - pad * 1.5).lte("lon", Math.max(...lon) + pad * 1.5)
          .order("created_at", { ascending: false }).limit(300);
        if (!error) rows = data;
      }
    } catch {}
    if (my !== token) return;
    if (!rows) { shown.forEach((a) => say(a, `<small>Rider reports aren't available right now.</small>`)); return; }
    shown.forEach((a) => {
      const mine = rows.filter((r) => { let best = null, d = AREA_KM; shown.forEach((b) => { const k = kmTo([r.lat, r.lon], b.c); if (k < d) { d = k; best = b; } }); return best === a; });
      if (!mine.length) { say(a, `<small>No rider reports this week.</small>`); return; }
      const trees = mine.filter((r) => r.condition === "trees_down").length, last = mine[0];
      say(a, `${mine.length} report${mine.length > 1 ? "s" : ""} this week · latest: ${esc(REPORT[last.condition] || last.condition)}${last.trail_name ? ` on ${esc(last.trail_name)}` : ""} (${ago(Date.parse(last.created_at))})${trees ? ` · <span class="td-warn">🌲 ${trees} tree${trees > 1 ? "s" : ""} down</span>` : ""}`);
    });
  }

  // Closures and warnings from the land managers within the area (closures.js): Alberta Parks closed trails, BC Parks
  // advisories, Parks Canada bulletins.
  async function addClosures(areas, my) {
    if (!window.tfClosures) return;
    for (const a of areas.filter((x) => x.el)) {
      const list = await window.tfClosures.near(a.c, AREA_KM).catch(() => []);
      if (my !== token) return;
      const p = a.el.querySelector(".td-close");
      if (!p || !list.length) continue;
      const bad = list.filter((x) => x.bad);
      p.innerHTML = `<span class="${bad.length ? "td-warn" : ""}">🚧 ${list.length} closure${list.length > 1 ? "s" : ""} or warning${list.length > 1 ? "s" : ""}:</span> ${list.slice(0, 3).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.text)}</a>`).join(" · ")}${list.length > 3 ? ` <small>and ${list.length - 3} more (🚧 layer)</small>` : ""}`;
    }
  }

  // Wildfires within 25 km and evacuation orders or alerts close by.
  async function addFires(areas, my) {
    const f = await fireData().catch(() => null);
    if (my !== token || !f) return;
    areas.filter((a) => a.el).forEach((a) => {
      const near = f.fires.filter((x) => x.st !== "Out" && x.lat != null && kmTo([x.lat, x.lon], a.c) <= FIRE_KM).map((x) => ({ ...x, km: kmTo([x.lat, x.lon], a.c) })).sort((x, y) => x.km - y.km);
      const evac = f.evac.filter((e) => (e.g || []).some((ring) => { for (let i = 0; i + 1 < ring.length; i += 2) if (kmTo([ring[i], ring[i + 1]], a.c) <= AREA_KM) return true; return false; }));
      const p = a.el.querySelector(".td-fire");
      const parts = [];
      if (near.length) parts.push(`🔥 ${near.length > 1 ? `${near.length} wildfires, nearest` : "Wildfire"} ${Math.round(near[0].km)} km away (${esc(near[0].st || "active")})`);
      if (evac.length) parts.push(`⚠ Evacuation ${evac.some((e) => e.kind !== "alert") ? "order" : "alert"} nearby: ${esc(evac[0].n || evac[0].st || "")}`);
      p.innerHTML = parts.length ? `<span class="td-warn">${parts.join(" · ")}</span>` : "";
      p.hidden = !parts.length;
    });
  }
})();
