// "Help improve Trail Finder" (alex approved the design 2026-10-24): an opt-in switch in My rides (ride.html), off for
// everyone until they turn it on. When on, a trimmed copy of each ride's line goes to the app's Supabase project
// (supabase/ride-share.sql, table shared_rides) with no name, no account and no photos, only the month it was ridden.
// A nightly job (scripts/build-community.mjs) turns everyone's lines into data/community.json: trails riders use that
// aren't on the map, which way trails are ridden and how busy they are, each only once 3 or more riders back it up
// (community.js shows them on the map).
// Trimmed here, before anything is sent: the first and last 500 m of the ride, anything within 500 m of a private place
// (the rider's own, plus any spot where 3 or more of their rides start or end), stretches at car speed, and what's left under
// 1 km isn't sent. Rides that came in through Strava sync (strava.js) are never shared: Strava's API rules don't allow
// it. Rides recorded here and rides imported from the rider's own files (a Strava archive too) are theirs to share.
// Settings (kept in the account with the others when signed in): tf:shareOn, tf:shareKey (a random code: the table
// only keeps an md5 of it, never the account), tf:sharePast, tf:shareFrom, tf:sharePlaces. This device remembers what
// it sent in tf:shareSent ({ ride id: line size }) and the rides the rider kept back in tf:shareNo.
(() => {
  "use strict";
  const acct = window.tfAccount;
  if (!acct || !acct.enabled) return;
  const $ = (id) => document.getElementById(id);
  const TRIM_M = 500, PLACE_M = 500, MIN_M = 1000, MIN_PIECE_M = 200, STEP_M = 10, CAR_MS = 40 / 3.6;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v, synced) {   // "tf:setting" tells account.js to save the setting to the rider's account
      try { localStorage.setItem("tf:" + k, JSON.stringify(v)); if (synced) window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const on = () => !!store.get("shareOn", false);

  // ---------- calls to the database (plain REST: no sign-in needed) ----------
  async function rpc(fn, args) {
    const r = await fetch(`${acct.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: acct.key, ...(acct.key.startsWith("sb_") ? {} : { Authorization: `Bearer ${acct.key}` }), "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) {
      let msg = "";
      try { msg = (await r.json()).message || ""; } catch {}
      throw new Error(r.status === 404 ? "sharing isn't set up yet" : msg || "error " + r.status);
    }
    return r.json();
  }
  function key() {
    let k = store.get("shareKey", null);
    if (!k) { k = crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)); store.set("shareKey", k, true); }
    return k;
  }
  // The ride's id has its start time in it: only a hash of it is sent.
  async function rideRef(id) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("tf-share:" + id)));
    return [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ---------- which rides, and trimming them ----------
  const viaStravaApi = (r) => r.imported && r.imported.strava != null && !r.imported.archive;
  const isBike = (r) => !r.sport || (window.tfRideFiles ? window.tfRideFiles.isBike(r.sport) !== false : !/ski|run|hike|walk/i.test(r.sport));
  function shareable(r) {
    return r.points && r.points.length > 20 && !viaStravaApi(r) && isBike(r) && !store.get("shareNo", []).includes(r.id);
  }
  function metres(a, b) {
    const R = 6371008.8, rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // Spots where 2 or more of the rider's rides start or end (home, work, a friend's place): trimmed like private places.
  function busyStarts(rides) {
    const ends = rides.flatMap((r) => (r.points && r.points.length ? [r.points[0], r.points[r.points.length - 1]] : []));
    const out = [];
    ends.forEach((p) => {
      if (out.some((q) => metres(p, q) < PLACE_M)) return;
      const near = ends.filter((q) => metres(p, q) < 300);
      if (near.length >= 3) out.push([near.reduce((a, q) => a + q[0], 0) / near.length, near.reduce((a, q) => a + q[1], 0) / near.length, near.length]);
    });
    return out.sort((a, b) => b[2] - a[2]);
  }
  // The pieces of the ride that may be sent: [[lat, lon, seconds], ...] each, every ~10 m.
  function trim(ride, places) {
    const brk = new Set(ride.breaks || []), pts = ride.points;
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + (brk.has(i) ? 0 : metres(pts[i - 1], pts[i])));
    const total = along[along.length - 1];
    if (total < MIN_M + 2 * TRIM_M) return [];
    const keep = pts.map((p, i) => !p[5] && !(p[4] != null && p[4] > 30) && along[i] >= TRIM_M && along[i] <= total - TRIM_M && !places.some((q) => metres(p, q) < PLACE_M));
    // car speed: over the 30 s around the point
    for (let i = 0, j = 0; i < pts.length; i++) {
      while (j < pts.length - 1 && pts[j][3] - pts[i][3] < 30000) j++;
      const dt = (pts[j][3] - pts[i][3]) / 1000;
      if (dt >= 20 && (along[j] - along[i]) / dt > CAR_MS) for (let k = i; k <= j; k++) keep[k] = false;
    }
    const pieces = [];
    let cur = null, last = null;
    pts.forEach((p, i) => {
      const gap = last && (brk.has(i) || metres(last, p) > 80 || p[3] - last[3] > 60000);
      if (!keep[i] || gap) { if (cur && cur.m >= MIN_PIECE_M) pieces.push(cur); cur = null; if (!keep[i]) { last = null; return; } }
      if (!cur) cur = { t0: p[3], m: 0, g: [] };
      const prev = cur.g[cur.g.length - 1];
      if (last && !gap) cur.m += metres(last, p);
      if (!prev || metres(prev, p) >= STEP_M) cur.g.push([+p[0].toFixed(5), +p[1].toFixed(5), Math.round((p[3] - cur.t0) / 1000)]);
      last = p;
    });
    if (cur && cur.m >= MIN_PIECE_M) pieces.push(cur);
    const m = pieces.reduce((a, c) => a + c.m, 0);
    return m >= MIN_M ? pieces.map((c) => c.g).slice(0, 50) : [];
  }

  // ---------- sending ----------
  let running = null, status = "";
  const allRides = () => new Promise((resolve) => {
    const r = indexedDB.open("trail-finder-rides", 1);
    r.onupgradeneeded = () => {   // the same stores as ride.html, which may not have made them yet
      const db = r.result;
      db.createObjectStore("rides", { keyPath: "id" });
      db.createObjectStore("photos", { keyPath: "id" }).createIndex("rideId", "rideId");
      db.createObjectStore("current", { keyPath: "id" });
    };
    r.onsuccess = () => { try { const q = r.result.transaction("rides").objectStore("rides").getAll(); q.onsuccess = () => resolve(q.result || []); q.onerror = () => resolve([]); } catch { resolve([]); } };
    r.onerror = () => resolve([]);
  });
  async function places(rides) {
    return [...store.get("sharePlaces", []).map((p) => [p[0], p[1]]), ...busyStarts(rides)];
  }
  async function shareOne(r, pl, sent) {
    const line = trim(r, pl);
    if (line.length) {
      const d = new Date(r.start);
      await rpc("share_ride", { p_key: key(), p_ride: await rideRef(r.id), p_month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, p_ebike: /e-?(mountain )?bike|électrique/i.test(r.sport || ""), p_line: line });
    }
    sent[r.id] = line.reduce((a, l) => a + l.length, 0);   // 0: nothing left after trimming
    store.set("shareSent", sent);
  }
  function sync() {
    if (!on() || running) return running;
    running = (async () => {
      const rides = await allRides(), pl = await places(rides), sent = store.get("shareSent", {});
      const from = store.get("shareFrom", 0), past = store.get("sharePast", false), yes = store.get("shareYes", []);
      const todo = rides.filter((r) => shareable(r) && !(r.id in sent) && (past || yes.includes(r.id) || (r.saved || r.start) >= from));
      let n = 0;
      for (const r of todo) {
        if (!on()) break;
        status = `Sharing ride ${++n} of ${todo.length}…`; paint();
        try { await shareOne(r, pl, sent); }
        catch (e) { status = `Couldn't share just now (${e.message}). It tries again next time.`; paint(); running = null; return; }
      }
      status = ""; running = null; refreshCount();
    })();
    return running;
  }
  async function unshare(r) {
    const no = store.get("shareNo", []).filter((x) => x !== r.id);
    no.unshift(r.id);
    store.set("shareNo", no.slice(0, 2000));
    const sent = store.get("shareSent", {});
    if (sent[r.id]) await rpc("unshare_ride", { p_key: key(), p_ride: await rideRef(r.id) });
    delete sent[r.id]; store.set("shareSent", sent);
    refreshCount();
  }
  // "Share this ride" on one kept back (or from before the switch, when past rides aren't shared): this one goes.
  async function reshare(r) {
    store.set("shareNo", store.get("shareNo", []).filter((x) => x !== r.id));
    store.set("shareYes", [r.id, ...store.get("shareYes", []).filter((x) => x !== r.id)].slice(0, 2000));
    const sent = store.get("shareSent", {}); delete sent[r.id];
    await shareOne(r, await places(await allRides()), sent);
    refreshCount();
  }

  // ---------- the box in My rides ----------
  let count = null;
  async function refreshCount() {
    if (!store.get("shareKey", null)) { count = 0; paint(); return; }
    try { count = await rpc("shared_count", { p_key: key() }); } catch { count = null; }
    paint();
  }
  const css = document.createElement("style");
  css.textContent = `
.share { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.share p { margin: 0; font-size: .92rem; }
.share h3 { margin: 0; font-size: 1rem; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.share .sw { position: relative; width: 46px; height: 26px; flex: none; }
.share .sw input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.share .sw span { position: absolute; inset: 0; border-radius: 999px; background: var(--line); transition: background .15s; pointer-events: none; }
.share .sw span::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 2px rgba(0,0,0,.3); }
.share .sw input:checked + span { background: var(--accent); }
.share .sw input:checked + span::after { transform: translateX(20px); }
.share .sw input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
.share blockquote { margin: 0; padding: 8px 10px; border-left: 4px solid var(--accent); background: var(--chip); border-radius: 6px; font-size: .9rem; }
.share blockquote p + p { margin-top: 6px; }
.share ul { margin: 0; padding-left: 1.2em; font-size: .9rem; }
.share .linkish { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }
.share .small { font-size: .82rem; color: var(--muted); }
.ride-share { font-size: .88rem; color: var(--muted); margin: 0; }
.ride-share .linkish { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }`;
  document.head.appendChild(css);

  const box = document.createElement("div");
  box.className = "share"; box.id = "shareBox";
  const anchor = $("rideList");
  if (anchor) anchor.before(box);
  let asking = false, rideCount = 0, suggest = null;
  const fmtPlace = (p) => `${p[0].toFixed(3)}, ${p[1].toFixed(3)}`;
  async function paint() {
    if (!box.isConnected) return;
    const sw = `<label class="sw"><input type="checkbox" id="shareSw" ${on() ? "checked" : ""} aria-label="Help improve Trail Finder"><span></span></label>`;
    if (asking) {
      box.innerHTML = `<h3>Help improve Trail Finder</h3>
<blockquote><p>Share the line of your rides, without your name, so the app can find new trails, learn which way trails are ridden and show which ones are busy.</p>
<p>We cut the first and last 500 m of every ride and anything near the private places you choose, like home.</p>
<p>Only results backed by 3 or more riders are ever shown. You can stop and delete everything you shared at any time.</p></blockquote>
<label class="tick"><input type="checkbox" id="sharePastQ"> <span>Share my past rides too${rideCount ? ` (${rideCount})` : ""}</span></label>
<div class="actions"><button class="btn primary" type="button" data-yes>Share my rides</button><button class="btn" type="button" data-no>Not now</button></div>`;
      return;
    }
    if (!on()) {
      box.innerHTML = `<h3>Help improve Trail Finder ${sw}</h3><p class="small">Off. Turn it on to share your ride lines, without your name, to help find new trails and see which way trails are ridden.</p>`;
      return;
    }
    const pl = store.get("sharePlaces", []), past = store.get("sharePast", false);
    box.innerHTML = `<h3>Help improve Trail Finder ${sw}</h3>
<p>On. ${count == null ? "" : count ? `${count} ride${count > 1 ? "s" : ""} shared. ` : "Nothing shared yet. "}${past ? "Past and new rides" : "New rides from now on"} are shared without your name. Rides from Strava sync never are.</p>
${status ? `<p class="small" role="status">${esc(status)}</p>` : ""}
${past ? "" : `<p><button class="linkish" type="button" data-past>Share my past rides too${rideCount ? ` (${rideCount})` : ""}</button></p>`}
<p><strong>Private places</strong> <span class="small">(nothing within 500 m of them is shared; spots where several of your rides start are left out on their own)</span></p>
${pl.length ? `<ul>${pl.map((p, i) => `<li>${esc(p[2] || "Private place")} (${fmtPlace(p)}) <button class="linkish" type="button" data-rmp="${i}">Remove</button></li>`).join("")}</ul>` : ""}
<div class="actions">${suggest && !pl.some((p) => metres(p, suggest) < PLACE_M) ? `<button class="btn" type="button" data-sug>Add where most rides start (${fmtPlace(suggest)})</button>` : ""}${pl.length < 5 ? `<button class="btn" type="button" data-here>Add where I am now</button>` : ""}</div>
<p><button class="linkish" type="button" data-del>Delete what I've shared</button></p>`;
  }
  box.addEventListener("change", async (e) => {
    if (e.target.id !== "shareSw") return;
    if (e.target.checked) { const r = await allRides(); rideCount = r.filter(shareable).length; asking = true; paint(); return; }
    store.set("shareOn", false, true); status = ""; paint();
  });
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-yes")) {
      store.set("sharePast", !!($("sharePastQ") && $("sharePastQ").checked), true);
      store.set("shareFrom", Date.now(), true);
      store.set("shareOn", true, true); key();
      asking = false; paint(); sync();
    } else if (b.hasAttribute("data-no")) { asking = false; paint(); }
    else if (b.hasAttribute("data-past")) { store.set("sharePast", true, true); paint(); sync(); }
    else if (b.hasAttribute("data-rmp")) { const pl = store.get("sharePlaces", []); pl.splice(+b.dataset.rmp, 1); store.set("sharePlaces", pl, true); paint(); }
    else if (b.hasAttribute("data-sug") && suggest) { addPlace([+suggest[0].toFixed(4), +suggest[1].toFixed(4), "Where most rides start"]); }
    else if (b.hasAttribute("data-here")) {
      b.disabled = true;
      navigator.geolocation.getCurrentPosition((p) => addPlace([+p.coords.latitude.toFixed(4), +p.coords.longitude.toFixed(4), "Added here"]), () => { b.disabled = false; alert("Couldn't get your location."); }, { enableHighAccuracy: true, timeout: 15000 });
    } else if (b.hasAttribute("data-del")) {
      if (!confirm("Delete every ride you've shared? Results built from them go at the next nightly update. Sharing also turns off.")) return;
      b.disabled = true;
      try {
        const n = await rpc("unshare_all", { p_key: key() });
        store.set("shareOn", false, true); store.set("shareSent", {});
        status = ""; count = 0; paint();
        alert(`Deleted ${n} shared ride${n === 1 ? "" : "s"}.`);
      } catch (err) { alert("Couldn't delete just now: " + err.message); b.disabled = false; }
    }
  });
  async function addPlace(p) {
    const pl = store.get("sharePlaces", []);
    pl.push(p); store.set("sharePlaces", pl.slice(0, 5), true);
    // rides already shared that pass near the new place: sent again, trimmed
    const sent = store.get("shareSent", {}), rides = await allRides();
    rides.forEach((r) => { if (sent[r.id] && r.points.some((q) => metres(q, p) < PLACE_M)) delete sent[r.id]; });
    store.set("shareSent", sent);
    paint(); sync();
  }

  // ---------- one ride's line in its page ----------
  function mountRide(el, r) {
    if (!el) return;
    if (!on() || !r) { el.innerHTML = ""; return; }
    if (viaStravaApi(r)) { el.innerHTML = `<p class="ride-share">Not shared: rides from Strava sync never are.</p>`; return; }
    if (!isBike(r)) { el.innerHTML = ""; return; }
    const no = store.get("shareNo", []).includes(r.id), sent = store.get("shareSent", {})[r.id];
    el.innerHTML = no ? `<p class="ride-share">Not shared. <button class="linkish" type="button">Share this ride</button></p>`
      : sent ? `<p class="ride-share">Shared to help improve Trail Finder, trimmed and without your name. <button class="linkish" type="button">Don't share this ride</button></p>`
        : sent === 0 ? `<p class="ride-share">Too short to share after trimming the ends and private places.</p>`
          : !store.get("sharePast", false) && !store.get("shareYes", []).includes(r.id) && (r.saved || r.start) < store.get("shareFrom", 0)
            ? `<p class="ride-share">Not shared (from before you turned sharing on). <button class="linkish" type="button" data-yes>Share this ride</button></p>`
            : `<p class="ride-share">Will be shared to help improve Trail Finder. <button class="linkish" type="button">Don't share this ride</button></p>`;
    const b = el.querySelector("button");
    if (b) b.addEventListener("click", async () => {
      b.disabled = true;
      try { if (no || b.hasAttribute("data-yes")) await reshare(r); else await unshare(r); } catch (e) { alert("Couldn't change it just now: " + e.message); }
      mountRide(el, r);
    });
  }

  window.tfShare = { kick: () => setTimeout(sync, 500), mountRide, trim, busyStarts };
  window.addEventListener("tf:settings-synced", (e) => { if (e.detail.some((k) => /^share/.test(k))) { paint(); sync(); } });
  (async () => {
    const rides = await allRides();
    rideCount = rides.filter(shareable).length;
    const b = busyStarts(rides); suggest = b.length ? b[0] : null;
    paint();
    if (on()) { refreshCount(); sync(); }
  })();
})();
