// Closures and warnings (alex, 2026-10-24: "closures and warnings from clubs and land managers shown on the map").
// What the land managers say, from the nightly data/closures.json (scripts/build-closures.mjs):
//  - Alberta Parks trail reports (Kananaskis, Bragg Creek, Canmore): each trail's status (Open, Closed, Partially closed,
//    Warning), its warning, and whether e-bikes are allowed on it, plus each area's conditions and closures.
//  - BC Parks advisories (trail closures, wildlife, washouts, bridges, hazards) for the park, at the park's middle.
//  - Parks Canada bulletins (area closures, bear warnings, cycling restrictions) for Banff, Yoho, Kootenay, Mount Revelstoke
//    and Glacier.
// And what the map and riders say: closures mapped on the trail (access or bicycle conditional rules, seasonal, disused),
// Whistler's alpine network closing for the winter, and rider reports of a closed trail or trees down (reports.js).
// Shown in the trail details (index.html calls tfClosures.show(trail) into #closures), on the map with the
// "🚧 Closures and warnings" layer, and in Where to ride today (status.js calls tfClosures.near).
(() => {
  "use strict";
  const T = window.tfToday, map = window.tfLeaflet, btn = document.getElementById("closeBtn");
  if (!T || !map || !window.L) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const kmTo = (a, b) => Math.hypot((a[1] - b[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180), (a[0] - b[0]) * 110.57);
  // Trail names compared as sets of words: "Crystal Line - West" is "West Crystal Line Trail".
  const words = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !/^(trail|trails|the|singletrack)$/.test(w));
  const nameKey = (s) => words(s).sort().join(" ");
  const ALBERTA = (ll) => ll[0] > 50.3 && ll[0] < 51.5 && ll[1] > -116.2 && ll[1] < -113.8;
  // Each national park's middle (for its pin on the map).
  const PC_PIN = { "Banff National Park": [51.178, -115.571], "Yoho National Park": [51.396, -116.49], "Kootenay National Park": [50.65, -116.04],
    "Mount Revelstoke National Park": [51.05, -118.15], "Glacier National Park": [51.30, -117.52] };
  const ago = (d) => { if (!d) return ""; const n = Math.round((Date.now() - Date.parse(d)) / 864e5); return n < 1 ? "today" : n === 1 ? "yesterday" : n < 60 ? `${n} days ago` : new Date(d).toLocaleDateString(undefined, { month: "short", year: "numeric" }); };

  const css = document.createElement("style");
  css.textContent = `
.cl-box { margin: 10px 0 0; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--line); font-size: .9rem; }
.cl-box.bad { border-color: #e5484d; background: color-mix(in srgb, #e5484d 9%, transparent); }
.cl-box.warn { border-color: #f5a524; background: color-mix(in srgb, #f5a524 10%, transparent); }
.cl-box h4 { margin: 0 0 4px; font-size: .92rem; }
.cl-box ul { margin: 4px 0 0; padding-left: 18px; } .cl-box li { margin: 2px 0; }
.cl-box details { margin-top: 4px; } .cl-box summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
.cl-st { font-weight: 700; } .cl-st.bad { color: #c22; } .cl-st.warn { color: #b26a00; } .cl-st.ok { color: #2f7d32; }
.cl-pin span { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px; border: 2px solid #fff; box-sizing: border-box; font-size: 14px;
  box-shadow: 0 0 0 1.5px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.4); cursor: pointer; background: #f5a524; }
.cl-pin.bad span { background: #e5484d; } .cl-pin.rider span { border-radius: 50%; background: #fff; }
.map-tools #closeBtn.on { background: #e5484d; border-color: #e5484d; color: #fff; }
.cl-pop ul { margin: 4px 0; padding-left: 16px; } .cl-pop li { margin: 2px 0; }`;
  document.head.append(css);

  // ---------- data ----------
  let dataP = null, data = null;
  function load() {
    if (!dataP) dataP = T.nightly("closures.json").then((f) => {
      if (!f || f.v !== 1) return null;
      const ap = new Map();   // name key -> [{ area, row }]
      (f.ab || []).forEach((area) => (area.trails || []).forEach((row) => {
        const k = nameKey(row.n);
        if (k) (ap.get(k) || ap.set(k, []).get(k)).push({ area, row });
      }));
      data = { ...f, apIndex: ap };
      window.dispatchEvent(new Event("tf:closures"));
      return data;
    }).catch(() => null);
    return dataP;
  }
  // Alberta: start loading soon after opening if the map is there, so the e-bike chip can use the trail table.
  setTimeout(() => { const c = T.center(); if (ALBERTA([c.lat, c.lng])) load(); }, 4000);

  const llOf = (t) => { const m = t.center || (t.geom && t.geom[Math.floor(t.geom.length / 2)]); return !m ? null : Array.isArray(m) ? m : [m.lat, m.lng]; };
  const nameOf = (t) => (t.tags && (t.tags.name || t.tags["mtb:name"])) || t.name || "";
  // The Alberta Parks trail table row for a trail (nearest report area when two share the name), or null.
  function apRow(name, ll) {
    if (!data || !ll || !ALBERTA(ll)) return null;
    const hits = data.apIndex.get(nameKey(name));
    if (!hits) return null;
    return hits.slice().sort((a, b) => (a.area.c ? kmTo(a.area.c, ll) : 99) - (b.area.c ? kmTo(b.area.c, ll) : 99))[0];
  }
  const stClass = (st) => (/closed/i.test(st || "") ? "bad" : /warn|caution|wet/i.test(st || "") ? "warn" : "ok");

  // Closures mapped on the trail itself (OpenStreetMap tags).
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  // "no @ (Nov 15-Jun 30)", "no @ (Dec-Apr)": is today inside the months? null when it can't be read.
  function inMonths(cond) {
    const m = String(cond).match(/\(?\s*([A-Za-z]{3})[a-z]*\s*(\d{1,2})?\s*-\s*([A-Za-z]{3})[a-z]*\s*(\d{1,2})?\s*\)?/);
    if (!m || MON[m[1].toLowerCase()] == null || MON[m[3].toLowerCase()] == null) return null;
    const now = new Date(), v = (mo, d) => mo * 32 + d, t = v(now.getMonth(), now.getDate());
    const a = v(MON[m[1].toLowerCase()], +(m[2] || 1)), b = v(MON[m[3].toLowerCase()], +(m[4] || 31));
    return a <= b ? t >= a && t <= b : t >= a || t <= b;
  }
  function mapped(tags) {
    const out = [];
    for (const k of ["access:conditional", "bicycle:conditional", "foot:conditional", "mtb:conditional"]) {
      const v = tags[k];
      if (!v || !/^\s*no\b/.test(v)) continue;
      const now = inMonths(v);
      out.push({ bad: now === true, text: `${now ? "Closed now" : "Closed part of the year"}${k.startsWith("bicycle") || k.startsWith("mtb") ? " to bikes" : ""}: ${v.replace(/^\s*no\s*@\s*/, "").replace(/[()]/g, "")} (mapped as ${k}=${v})` });
    }
    if (tags.seasonal && tags.seasonal !== "no") out.push({ text: `Seasonal trail${tags.seasonal === "yes" ? "" : `: ${tags.seasonal}`} (map tag)` });
    if (tags.access === "no" && !/^(yes|designated|permissive)$/.test(tags.bicycle || "")) out.push({ bad: true, text: "Mapped as closed to everyone (access=no)." });
    if (/^(yes|construction)$/.test(tags.construction || "") || tags.highway === "construction") out.push({ bad: true, text: "Mapped as under construction." });
    if (tags["disused:highway"] || tags["abandoned:highway"]) out.push({ warn: true, text: "Mapped as disused or abandoned." });
    if (/\bclosed?\b/i.test(tags.note || "") || /\bclosed?\b/i.test(tags.description || "")) out.push({ warn: true, text: `Map note: “${String(tags.note || tags.description).slice(0, 200)}”` });
    return out;
  }
  // Whistler's alpine network (above the Flank Trail): closed for the winter, November to May (RMOW).
  const WH_ALPINE = /^(lord of the squirrels|happy hour|into the mystic|with a twist|on the rocks|pot of gold|less|don'?t look back)\b/i;
  const whAlpine = (name, ll) => ll && ll[0] > 49.96 && ll[0] < 50.25 && ll[1] > -123.25 && ll[1] < -122.8 && WH_ALPINE.test(name);
  const nameIn = (name, s) => { const n = words(name).join(" "); return n.length >= 6 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(words(s).join(" ")); };

  // ---------- trail details ----------
  let current = null;
  async function show(t) {
    current = t;
    const box = () => (current === t ? document.getElementById("closures") : null);
    if (!box()) return;
    const ll = llOf(t), name = nameOf(t), tags = t.tags || {};
    const parts = [];
    mapped(tags).forEach((x) => parts.push({ cls: x.bad ? "bad" : x.warn ? "warn" : "", html: `<h4>🚧 On the map</h4>${esc(x.text)}` }));
    if (whAlpine(name, ll)) {
      const m = new Date().getMonth(), closed = m >= 10 || m <= 4;
      parts.push({ cls: closed ? "bad" : "", html: `<h4>🏔 Whistler alpine trail network</h4>${closed ? "<b>Closed for the winter now.</b> " : ""}The alpine network closes for hiking and biking from November to May, and opens once the snow is gone: check <a href="https://www.trailforks.com/region/whistler/" target="_blank" rel="noopener">Trailforks</a> for the opening. <span class="muted">Source: <a href="https://www.whistler.ca/culture-recreation/trails/alpine-trail-program/alpine-trail-network" target="_blank" rel="noopener">RMOW</a>.</span>` });
    }
    await load();
    if (!box()) return;
    if (data) {
      const hit = apRow(name, ll);
      if (hit) {
        const { area, row } = hit, c = stClass(row.st), mine = (area.closures || []).filter((x) => nameIn(row.n, x));
        const acts = row.act || [], bikes = acts.includes("bike") || acts.includes("fatbike");
        parts.push({ cls: c === "ok" ? "" : c, html: `<h4>Alberta Parks trail report: <span class="cl-st ${c}">${esc(row.st || "status not given")}</span></h4>
          ${row.warn ? `<p>${esc(row.warn)}</p>` : ""}${mine.length ? `<ul>${mine.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          <p class="muted">${esc(area.name)}${area.updated ? `, updated ${esc(area.updated)}` : ""}. ${bikes ? `Bikes${acts.includes("ebike") ? " and e-bikes" : " (not e-bikes)"} allowed.` : "Not listed for bikes."}
          <a href="${esc(row.url || area.url)}" target="_blank" rel="noopener">Alberta Parks</a></p>
          ${area.note ? `<details><summary>Conditions in ${esc(area.name)}</summary><p>${esc(area.note)}</p>${(area.closures || []).length ? `<p><b>Closures:</b></p><ul>${area.closures.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</details>` : ""}` });
      }
      if (ll) {
        const adv = (data.bc || []).filter((a) => nameIn(name, a.title + " " + a.desc) || a.parks.some((p) => kmTo(p.c, ll) <= 3) || (a.c && kmTo(a.c, ll) <= 2)).slice(0, 4);
        if (adv.length) parts.push({ cls: adv.some((a) => a.closed || /closure|closed/i.test(a.type + a.title)) ? "bad" : "warn", html: `<h4>BC Parks advisories nearby</h4><ul>${adv.map((a) =>
          `<li><b>${esc(a.title)}</b> <span class="muted">${esc(a.type)} · ${esc(a.parks[0].name)}${a.date ? ` · ${esc(ago(a.date))}` : ""}</span>${a.desc && a.desc !== a.title ? `<br>${esc(a.desc.slice(0, 220))}${a.desc.length > 220 ? "…" : ""}` : ""} <a href="${esc(a.parks[0].url)}" target="_blank" rel="noopener">Park page</a></li>`).join("")}</ul>` });
        const park = window.tfEbike && window.tfEbike.areaAt(ll[0], ll[1]);
        const bul = park ? (data.pc || []).filter((b) => b.park === park) : [];
        if (bul.length) {
          const named = bul.filter((b) => nameIn(name, b.title)), rest = bul.filter((b) => !named.includes(b));
          const li = (b) => `<li><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.title)}</a></li>`;
          parts.push({ cls: named.length ? "bad" : "", html: `<h4>Parks Canada: ${esc(park)}</h4>${named.length ? `<ul>${named.map(li).join("")}</ul>` : ""}
            <details${named.length ? "" : " open"}><summary>${rest.length} closure${rest.length === 1 ? "" : "s"} and warning${rest.length === 1 ? "" : "s"} in the park</summary><ul>${rest.map(li).join("")}</ul></details>` });
        }
      }
    }
    const el = box();
    if (!el) return;
    el.innerHTML = parts.map((p) => `<div class="cl-box ${p.cls}">${p.html}</div>`).join("");
  }

  // ---------- Where to ride today (status.js): notices within km of a spot ----------
  async function near(c, km) {
    await load();
    if (!data) return [];
    const out = [];
    (data.ab || []).forEach((a) => {
      if (!a.c || kmTo(a.c, c) > km) return;
      (a.trails || []).filter((r) => /closed/i.test(r.st || "") && (r.act || []).some((x) => x === "bike" || x === "ebike"))
        .forEach((r) => out.push({ bad: true, text: `${r.n}: ${r.st}${r.warn ? ` (${r.warn.split("\n")[0].slice(0, 80)})` : ""}`, url: r.url || a.url, src: "Alberta Parks" }));
    });
    (data.bc || []).forEach((a) => { if (a.parks.some((p) => kmTo(p.c, c) <= km) && /trail|bridge|wildlife|hazard|flood|wildfire|closure|access/i.test(a.type)) out.push({ bad: a.closed || /closure/i.test(a.type), text: `${a.title} (${a.parks[0].name})`, url: a.parks[0].url, src: "BC Parks" }); });
    Object.entries(PC_PIN).forEach(([park, p]) => { if (kmTo(p, c) <= km + 15) (data.pc || []).filter((b) => b.park === park && /closure|closed|warning/i.test(b.title)).forEach((b) => out.push({ text: b.title, url: b.url, src: "Parks Canada" })); });
    return out;
  }

  // ---------- map layer ----------
  if (!btn) { window.tfClosures = { show, near, load, apRow, mapped }; return; }
  map.createPane("closures").style.zIndex = 616;
  const layer = L.layerGroup(), pins = new Map();
  let on = false;
  try { on = JSON.parse(localStorage.getItem("tf:closures") || "false") === true; } catch {}
  const pinIcon = (cls, txt) => L.divIcon({ className: `cl-pin ${cls}`, html: `<span>${txt}</span>`, iconSize: [26, 26] });
  function add(id, ll, cls, txt, title, html) {
    if (pins.has(id)) return;
    const m = L.marker(ll, { pane: "closures", icon: pinIcon(cls, txt), title, keyboard: false }).bindPopup(`<div class="road-pop cl-pop">${html}</div>`, { maxWidth: 300 });
    pins.set(id, m); layer.addLayer(m);
  }
  let riderAt = 0, riderBox = null;
  async function draw() {
    if (!on) { layer.clearLayers(); pins.clear(); return; }
    await load();
    if (!on || !data) return;
    (data.ab || []).forEach((a) => {
      const bad = (a.trails || []).filter((r) => !/^open$/i.test(r.st || "")), closed = bad.filter((r) => /closed/i.test(r.st || ""));
      if (!a.c || (!bad.length && !(a.closures || []).length)) return;
      add(`ab:${a.id}`, a.c, closed.length ? "bad" : "", "🚧", `Alberta Parks: ${a.name}`, `<h4>${esc(a.name)} (Alberta Parks)</h4>
        ${bad.length ? `<ul>${bad.map((r) => `<li><b>${esc(r.n)}</b>: ${esc(r.st)}${r.warn ? `<br><span class="muted">${esc(r.warn.slice(0, 160))}</span>` : ""}</li>`).join("")}</ul>` : ""}
        ${(a.closures || []).length ? `<p><b>Closures:</b></p><ul>${a.closures.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        <p class="src">${a.updated ? `Updated ${esc(a.updated)} · ` : ""}<a href="${esc(a.url)}" target="_blank" rel="noopener">Trail report</a></p>`);
    });
    const byPark = new Map();
    (data.bc || []).forEach((a) => a.parks.forEach((p) => { if (!byPark.has(p.name)) byPark.set(p.name, { p, list: [] }); byPark.get(p.name).list.push(a); }));
    byPark.forEach(({ p, list }) => {
      const bad = list.some((a) => a.closed || /closure|closed/i.test(a.type + " " + a.title));
      add(`bc:${p.name}`, p.c, bad ? "bad" : "", "⚠", `BC Parks: ${p.name}`, `<h4>${esc(p.name)} (BC Parks)</h4><ul>${list.slice(0, 8).map((a) => `<li><b>${esc(a.title)}</b> <span class="muted">${esc(a.type)}${a.date ? ` · ${esc(ago(a.date))}` : ""}</span></li>`).join("")}</ul>
        <p class="src"><a href="${esc(p.url)}" target="_blank" rel="noopener">Park page and advisories</a></p>`);
    });
    Object.entries(PC_PIN).forEach(([park, ll]) => {
      const list = (data.pc || []).filter((b) => b.park === park);
      if (list.length) add(`pc:${park}`, ll, "", "⚠", `Parks Canada: ${park}`, `<h4>${esc(park)}</h4><ul>${list.map((b) => `<li><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.title)}</a></li>`).join("")}</ul><p class="src">Parks Canada bulletins</p>`);
    });
    if (!layer._map) layer.addTo(map);
    riders();
  }
  // Rider reports of a closed trail or trees down in the last 14 days, in view (zoom 9 and in), at most once a minute per view.
  async function riders() {
    const acct = window.tfAccount;
    if (!on || !acct || !acct.enabled || map.getZoom() < 9) return;
    const b = map.getBounds().pad(0.3);
    if (riderBox && riderBox.contains(map.getBounds()) && Date.now() - riderAt < 60000) return;
    riderBox = b; riderAt = Date.now();
    try {
      await acct.load();
      if (!acct.client) return;
      const { data: rows, error } = await acct.client.from("trail_reports").select("id, condition, note, created_at, lat, lon, trail_name")
        .in("condition", ["closed", "trees_down"]).gte("created_at", new Date(Date.now() - 14 * 864e5).toISOString())
        .gte("lat", b.getSouth()).lte("lat", b.getNorth()).gte("lon", b.getWest()).lte("lon", b.getEast()).order("created_at", { ascending: false }).limit(200);
      if (error || !on) return;
      rows.forEach((r) => add(`r:${r.id}`, [r.lat, r.lon], "rider", r.condition === "closed" ? "🚧" : "🌲", `Rider report: ${r.condition === "closed" ? "closed" : "trees down"}`,
        `<h4>${esc(r.trail_name || "A trail")}</h4><p><b>${r.condition === "closed" ? "🚧 Closed" : "🌲 Trees down"}</b>, says a rider ${esc(ago(r.created_at))}.</p>${r.note ? `<p>“${esc(r.note)}”</p>` : ""}`));
    } catch {}
  }
  map.on("moveend", () => { if (on) riders(); });
  function sync() {
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("on", on);
    btn.title = on ? "Hide the closures and warnings" : "Show closures and warnings from Alberta Parks, BC Parks, Parks Canada and riders";
  }
  btn.addEventListener("click", () => {
    on = !on;
    try { localStorage.setItem("tf:closures", JSON.stringify(on)); } catch {}
    sync(); draw();
  });
  sync();
  if (on) draw();
  window.tfClosures = { show, near, load, apRow, mapped, on: () => on };
})();
