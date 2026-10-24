// Possible new trails from your rides: the stretches of a saved ride (recorded, or imported from Strava / GPX / FIT)
// that follow nothing mapped in OpenStreetMap: no trail, path, track or road within 30 m, for at least 150 m, and
// at least 45 m away from one somewhere along it (so a GPS track drifting beside a mapped trail doesn't count).
// ride.html shows them under a ride (mount) with Save as a possible new trail / Not a trail; saved ones go to
// tf:myFinds (kept in the rider's account with the other settings) and show on the main map with My rides (rides.js).
// The ways near the ride come live from Overpass (both mirrors race, like the route planner), since the app's own
// data files only hold bike trails and forest roads, and a stretch along a street isn't a new trail.
(() => {
  "use strict";
  const OFF_M = 30, FAR_M = 45, MIN_M = 150, JOIN_M = 25, STEP_M = 5, MAX_ACC_M = 30;
  const AROUND_M = 60;           // ways fetched this close to the (simplified) ride
  const CACHE_DAYS = 7;          // check a ride again after a week: a mapper may have added the trail
  const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v, synced) {   // "tf:setting" tells account.js (optional sign-in) to save settings to the rider's account
      try { localStorage.setItem("tf:" + k, JSON.stringify(v)); if (synced) window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const changed = () => window.dispatchEvent(new Event("tf:finds"));
  window.addEventListener("tf:settings-synced", (e) => { if (e.detail.includes("myFinds")) changed(); });

  // ---------- geometry (flat metres around the ride's latitude) ----------
  let K = Math.cos(50 * Math.PI / 180);
  const metres = (a, b) => { const dy = (a[0] - b[0]) * 111195, dx = (a[1] - b[1]) * 111195 * K; return Math.sqrt(dx * dx + dy * dy); };
  function segDist(p, a, b) {
    const ax = a[1] * K * 111195, ay = a[0] * 111195, bx = b[1] * K * 111195 - ax, by = b[0] * 111195 - ay;
    const px = p[1] * K * 111195 - ax, py = p[0] * 111195 - ay, l = bx * bx + by * by;
    const t = l ? Math.max(0, Math.min(1, (px * bx + py * by) / l)) : 0;
    return Math.hypot(px - t * bx, py - t * by);
  }
  function simplify(pts, tol) {   // Douglas-Peucker, keeps the ends
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let far = -1, at = 0;
      for (let i = s + 1; i < e; i++) { const d = segDist(pts[i], pts[s], pts[e]); if (d > far) { far = d; at = i; } }
      if (far > tol) { keep[at] = 1; stack.push([s, at], [at, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  // The ride in pieces of real GPS fixes: split at Pause, at stretches filled in along the trails (no GPS), and
  // across jumps (a locked phone with no fill). Inaccurate fixes are left out.
  function piecesOf(ride) {
    const brk = new Set(ride.breaks || []), out = [];
    let cur = [];
    ride.points.forEach((p, i) => {
      const bad = p[5] || (p[4] != null && p[4] > MAX_ACC_M);
      const last = cur[cur.length - 1];
      if (brk.has(i) || p[5] || (last && !bad && (metres(last, p) > 80 || (p[3] - last[3]) > 60000))) { if (cur.length > 1) out.push(cur); cur = []; }
      if (!bad) cur.push(p);
    });
    if (cur.length > 1) out.push(cur);
    return out;
  }

  // ---------- the mapped ways near the ride, from Overpass ----------
  async function waysNear(pieces) {
    const lines = pieces.map((pc) => {
      let tol = 10, s = simplify(pc, tol);
      while (s.length > 1500) s = simplify(pc, tol *= 2);
      return s.map((p) => p[0].toFixed(5) + "," + p[1].toFixed(5)).join(",");
    });
    const around = (sel) => lines.map((l) => `way${sel}(around:${AROUND_M},${l});`).join("");
    const q = `[out:json][timeout:60];(${around("[highway]")}${around('["abandoned:highway"]')}${around('["disused:highway"]')});out tags geom;`;
    const ask = (url) => fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(70000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("OpenStreetMap answered " + r.status))))
      .then((j) => {
        if (j.remark && /error/i.test(j.remark)) throw new Error("OpenStreetMap was too busy");
        return j.elements.filter((x) => x.type === "way" && x.geometry && x.tags && x.tags.highway !== "proposed")
          .map((x) => ({ id: x.id, tags: x.tags, g: x.geometry.map((p) => [p.lat, p.lon]) }));
      });
    // The main Overpass first; if it hasn't answered in 3 s (busy), the other one races it.
    const wait = (f) => new Promise((ok) => setTimeout(ok, 3000)).then(f);
    try { return await Promise.any([ask(OVERPASS[0]), wait(() => ask(OVERPASS[1]))]); }
    catch (e) { throw new Error((e.errors && e.errors[0] && e.errors[0].message) || "Couldn't reach OpenStreetMap"); }
  }

  // ---------- finding the stretches ----------
  const CELL = 0.0005;            // ~55 m: a 3 x 3 search always sees FAR_M
  function analyse(ride, ways) {
    const pieces = piecesOf(ride);
    const grid = new Map(), key = (y, x) => y + ":" + x;
    const put = (p, w) => { const k = key(Math.floor(p[0] / CELL), Math.floor(p[1] * K / CELL)); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push([p[0], p[1], w]); };
    ways.forEach((w, wi) => w.g.forEach((p, i) => {
      put(p, wi);
      const q = w.g[i + 1]; if (!q) return;
      const n = Math.min(400, Math.floor(metres(p, q) / STEP_M));
      for (let s = 1; s < n; s++) put([p[0] + (q[0] - p[0]) * s / n, p[1] + (q[1] - p[1]) * s / n], wi);
    }));
    const nearest = (p) => {
      let d = Infinity, w = -1;
      const y = Math.floor(p[0] / CELL), x = Math.floor(p[1] * K / CELL);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const c = grid.get(key(y + dy, x + dx));
        if (c) for (const q of c) { const m = metres(p, q); if (m < d) { d = m; w = q[2]; } }
      }
      return { d, w };
    };
    const out = [];
    pieces.forEach((pc) => {
      // Samples every ~5 m along the piece: [lat, lon, alt, time, metres along, distance to the nearest way, way]
      const sm = [];
      let along = 0;
      pc.forEach((p, i) => {
        if (i) {
          const a = pc[i - 1], d = metres(a, p), n = Math.max(1, Math.floor(d / STEP_M));
          for (let s = 1; s < n; s++) {
            const f = s / n, q = [a[0] + (p[0] - a[0]) * f, a[1] + (p[1] - a[1]) * f, null, a[3] + (p[3] - a[3]) * f, along + d * f];
            sm.push(q);
          }
          along += d;
        }
        sm.push([p[0], p[1], p[2], p[3], along]);
      });
      sm.forEach((q) => { const n = nearest(q); q[5] = n.d; q[6] = n.w; });
      // Runs of samples off the map, joined across short touches of a mapped way (crossing a trail).
      const runs = [];
      let s = -1;
      for (let i = 0; i <= sm.length; i++) {
        const off = i < sm.length && sm[i][5] > OFF_M;
        if (off && s < 0) s = i;
        if (!off && s >= 0) { runs.push([s, i - 1]); s = -1; }
      }
      const joined = [];
      runs.forEach((r) => {
        const last = joined[joined.length - 1];
        if (last && sm[r[0]][4] - sm[last[1]][4] < JOIN_M) last[1] = r[1]; else joined.push(r.slice());
      });
      joined.forEach(([a, b]) => {
        // Reach back to the mapped ways at each end, so the line meets the trail it leaves and joins.
        const from = Math.max(0, a - 1), to = Math.min(sm.length - 1, b + 1);
        const len = sm[to][4] - sm[from][4];
        let far = 0; for (let i = a; i <= b; i++) far = Math.max(far, sm[i][5]);
        if (len < MIN_M || far < FAR_M) return;
        const secs = (sm[to][3] - sm[from][3]) / 1000;
        if (secs > 0 && (len / secs > 15 || len / secs < 0.7)) return;   // in a car, or GPS drifting while stopped
        const g = [];
        for (let i = from; i <= to; i++) if (!g.length || i === to || metres(g[g.length - 1], sm[i]) >= 8) g.push([+sm[i][0].toFixed(5), +sm[i][1].toFixed(5)]);
        const alts = [];
        pc.forEach((p) => { if (p[3] >= sm[from][3] && p[3] <= sm[to][3] && p[2] != null) alts.push(p[2]); });
        const ud = alts.length > 2 && window.tfRideStats ? window.tfRideStats.upDown(alts) : null;
        const nameOf = (i) => { const w = ways[sm[i][6]]; return sm[i][5] <= FAR_M && w ? w.tags.name || w.tags["mtb:name"] || w.tags.ref || "" : ""; };
        out.push({
          id: ride.id + ":" + Math.round(sm[from][3] / 1000), ride: ride.id, title: ride.title, at: sm[from][3] || ride.start,
          m: Math.round(len), up: ud ? Math.round(ud.up) : null, down: ud ? Math.round(ud.down) : null,
          from: nameOf(from), to: nameOf(to), g,
        });
      });
    });
    return out;
  }

  // ---------- saved finds (tf:myFinds, in the account), "Not a trail" (tf:myFindsNo, this device) ----------
  const saved = () => store.get("myFinds", []).filter((f) => f && f.id && Array.isArray(f.g));
  const noList = () => store.get("myFindsNo", []);
  function save(sec, name) {
    const list = saved().filter((f) => f.id !== sec.id);
    list.unshift({ ...sec, name: (name || "").trim().slice(0, 80), saved: Date.now() });
    store.set("myFinds", list.slice(0, 200), true); changed();
  }
  function remove(id) { store.set("myFinds", saved().filter((f) => f.id !== id), true); changed(); }
  function dismiss(id, no = true) {
    const l = noList().filter((x) => x !== id);
    if (no) l.unshift(id);
    store.set("myFindsNo", l.slice(0, 500)); changed();
  }
  // A stretch already saved from another ride: most of it within 25 m of that find.
  function savedLike(sec) {
    for (const f of saved()) {
      if (f.id === sec.id) return f;
      let hit = 0;
      sec.g.forEach((p) => { for (let i = 1; i < f.g.length; i++) if (segDist(p, f.g[i - 1], f.g[i]) <= 25) { hit++; break; } });
      if (hit >= sec.g.length * 0.6) return f;
    }
    return null;
  }

  // Results kept per ride on this device (tf:findsCache), so opening a ride again doesn't ask OpenStreetMap again.
  async function check(ride, fresh) {
    const lats = ride.points.map((p) => p[0]);
    if (!lats.length) return [];
    K = Math.cos((lats.reduce((a, b) => a + b, 0) / lats.length) * Math.PI / 180);
    const cache = store.get("findsCache", {}), c = cache[ride.id];
    if (!fresh && c && c.n === ride.points.length && c.at > Date.now() - CACHE_DAYS * 864e5) return c.sections;
    const pieces = piecesOf(ride);
    const sections = pieces.length ? analyse(ride, await waysNear(pieces)) : [];
    cache[ride.id] = { at: Date.now(), n: ride.points.length, sections };
    // The newest 40 rides, plus up to 150 more that found something (a big Strava import checks hundreds of rides).
    const all = Object.entries(cache).sort((a, b) => b[1].at - a[1].at);
    const keep = [...all.slice(0, 40), ...all.slice(40).filter(([, v]) => v.sections.length).slice(0, 150)];
    store.set("findsCache", Object.fromEntries(keep));
    return sections;
  }

  const fmtM = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m / 10) * 10 + " m");
  const ends = (f) => (f.from && f.to && f.from !== f.to ? `from ${esc(f.from)} to ${esc(f.to)}` : f.from || f.to ? `off ${esc(f.from || f.to)}` : "");
  const facts = (f) => [`<b>${fmtM(f.m)}</b>`, f.down ? `${f.down} m down` : "", f.up ? `${f.up} m up` : "", ends(f)].filter(Boolean).join(" · ");
  const osmEdit = (f) => { const p = f.g[Math.floor(f.g.length / 2)]; return `https://www.openstreetmap.org/edit?editor=id#map=18/${p[0]}/${p[1]}`; };
  const COLOR = "#7a4fd6";

  // ---------- ride.html: the box under a ride, and the stretches on its map ----------
  const css = document.createElement("style");
  css.textContent = `
.finds { background: var(--panel); border: 1.5px dashed ${COLOR}; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.finds:empty { display: none; }
.finds h3 { font-family: var(--font-display, inherit); font-size: 1.15rem; text-transform: uppercase; letter-spacing: .02em; margin: 0; }
.finds p { margin: 0; font-size: .9rem; color: var(--muted); }
.finds ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.finds li { display: grid; grid-template-columns: 26px 1fr; gap: 8px; align-items: start; }
.finds .num, .find-num { width: 24px; height: 24px; border-radius: 50%; background: ${COLOR}; color: #fff; font-weight: 700; font-size: .85rem; display: grid; place-items: center; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.25); }
.finds .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.finds .row .btn { padding: 6px 10px; font-size: .9rem; }
.finds .ok { color: var(--accent); font-weight: 600; }
.finds .linkish { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }`;
  document.head.appendChild(css);

  let mountSeq = 0;
  async function mount(box, ride, map, fresh) {
    const seq = ++mountSeq;
    if (!box || !ride || !window.L) return;
    if (!map._findsLayer) map._findsLayer = L.layerGroup().addTo(map);
    const lay = map._findsLayer;
    lay.clearLayers();
    box.innerHTML = `<p>Looking for stretches of this ride that aren't on the map…</p>`;
    let secs;
    try { secs = await check(ride, fresh); }
    catch (e) {
      if (seq !== mountSeq) return;
      box.innerHTML = `<p>Couldn't check this ride for new trails (${esc(e.message)}).</p><div class="row"><button class="btn" type="button">Try again</button></div>`;
      box.querySelector("button").addEventListener("click", () => mount(box, ride, map, true));
      return;
    }
    if (seq !== mountSeq) return;
    const render = () => {
      lay.clearLayers();
      const no = new Set(noList()), shown = secs.filter((s) => !no.has(s.id)), hidden = secs.length - shown.length;
      if (!secs.length) { box.innerHTML = `<p>Every part of this ride follows a trail, path or road that's on OpenStreetMap.</p>`; return; }
      box.innerHTML = `<h3>🆕 Possible new trails on this ride</h3>
<p>${shown.length ? `${shown.length === 1 ? "One stretch" : shown.length + " stretches"} of this ride follow${shown.length === 1 ? "s" : ""} no trail, path or road on OpenStreetMap. If it's a real trail, save it: it shows on the main map with 🚵 My rides, and you can add it to OpenStreetMap so everyone gets it.` : "Nothing left to look at here."}</p>
<ol></ol>${hidden ? `<p>${hidden} marked “Not a trail”. <button class="linkish" type="button" data-unhide>Show ${hidden === 1 ? "it" : "them"}</button></p>` : ""}`;
      const ol = box.querySelector("ol");
      shown.forEach((s, i) => {
        const have = savedLike(s), mine = have && have.id === s.id;
        const li = document.createElement("li");
        li.innerHTML = `<span class="num">${i + 1}</span><div><div>${facts(s)}</div>
<div class="row">${have
  ? `<span class="ok">✓ ${mine ? "Saved" : "Already saved"}${have.name ? ` as “${esc(have.name)}”` : ""}</span> <a class="btn" href="${osmEdit(s)}" target="_blank" rel="noopener">Add to OpenStreetMap</a>${mine ? `<button class="btn" type="button" data-rm>Remove</button>` : ""}`
  : `<button class="btn primary" type="button" data-save>Save as a possible new trail</button><button class="btn" type="button" data-no>Not a trail</button>`}<button class="btn" type="button" data-show>Show</button></div></div>`;
        const line = L.polyline(s.g, { color: COLOR, weight: 7, opacity: 0.95, dashArray: have ? null : "10 7" }).addTo(lay);
        L.polyline(s.g, { color: "#fff", weight: 2, opacity: 0.9, interactive: false }).addTo(lay);
        L.marker(s.g[0], { icon: L.divIcon({ className: "", html: `<span class="find-num">${i + 1}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(lay);
        line.bindTooltip(`${i + 1}. Possible new trail · ${fmtM(s.m)}`, { sticky: true });
        const on = (sel, fn) => { const b = li.querySelector(sel); if (b) b.addEventListener("click", fn); };
        on("[data-show]", () => { map.fitBounds(line.getBounds(), { padding: [30, 30], maxZoom: 17 }); line.openTooltip(); const v = map.getContainer().closest(".view"); if (v) v.scrollTo({ top: 0, behavior: "smooth" }); });
        on("[data-save]", () => {
          const name = prompt("Give it a name if you like (or leave it blank)", "");
          if (name === null) return;
          save(s, name); render();
        });
        on("[data-no]", () => { dismiss(s.id); render(); });
        on("[data-rm]", () => { if (confirm("Remove this possible new trail from your saved ones?")) { remove(s.id); render(); } });
        ol.appendChild(li);
      });
      const un = box.querySelector("[data-unhide]");
      if (un) un.addEventListener("click", () => { secs.forEach((s) => dismiss(s.id, false)); render(); });
    };
    render();
  }

  window.tfRideFinds = { check, mount, saved, save, remove, dismiss, facts, osmEdit, fmtM, COLOR };
})();
