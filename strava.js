// Strava sync (alex, 2026-10-24: "add it all", from the MTB gaps list: rides come in from Strava on their own, no GPX
// exporting). The rider connects Strava once, in My rides (ride.html): Strava's own consent page, then back here. The
// keys Strava gives stay on the server (supabase/functions/strava, table strava_links), tied to the rider's account, so
// every device signed in to it brings in the new rides: on opening the app or My rides, at most every half hour, with
// each ride's full GPS track (latlng, time, altitude). They're saved like an imported file (ride.imported.strava = the
// Strava id), so My rides, the ridden trails on the map (rides.js) and the account's ride sync treat them the same.
// A ride already in My rides (the same ride recorded here, or a GPX import of it) is skipped: one that overlaps it in
// time by more than half. The first sync on a device goes back 30 days; "Get older rides" goes further, 50 at a time.
// Bike rides only (mountain, e-bike, gravel, road), never a trainer or a manual entry. Inside the iPhone app the consent
// page opens in Safari (the app only shows Trail Finder's own site); the connection is the account's, so the app picks
// it up when it's back in front.
(() => {
  "use strict";
  const acct = window.tfAccount, STATS = window.tfRideStats;
  if (!acct || !acct.enabled || !STATS) return;
  const FN = "strava";                    // the Supabase function's name (supabase/functions/strava)
  const KEY = "tf:strava";                // this device: { uid, athlete, scope, newest, oldest (s), done, at (ms) }
  const AUTO_MS = 30 * 60e3, ASK_MS = 6 * 3600e3, FIRST_DAYS = 30, MAX_PER_SYNC = 25, MIN_STEP_M = 5;
  const box0 = document.getElementById("importMsg");    // ride.html's My rides: the Strava box goes under Import
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const me = () => { const m = lsGet(KEY); return m && acct.user && m.uid === acct.user.id ? m : null; };
  const keep = (m) => lsSet(KEY, m);

  // Strava's answer, in the address it sends the rider back to: read it and take it out before anything else sees it
  // (the sign-in library also looks for a "code" there).
  let back = null;
  {
    const u = new URL(location.href);
    if (u.searchParams.get("strava") === "1") {
      back = { code: u.searchParams.get("code"), state: u.searchParams.get("state"), scope: u.searchParams.get("scope") || "", error: u.searchParams.get("error") };
      ["strava", "code", "state", "scope", "error"].forEach((k) => u.searchParams.delete(k));
      if (box0) u.hash = "#rides";
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    }
  }

  async function call(action, extra) {
    await acct.load();
    if (!acct.client) throw new Error("sign-in isn't available right now");
    const { data, error } = await acct.client.functions.invoke(FN, { body: { action, ...extra } });
    if (error) {
      let msg = "", gone = false;
      try { const j = await error.context.json(); msg = j.error || ""; gone = j.connected === false; } catch { /* not JSON */ }
      if (gone) keep(null);
      const st = error.context && error.context.status;
      throw new Error(msg || (st === 404 ? "the Strava link isn't set up yet" : st ? "error " + st : error.message || "no answer"));
    }
    return data;
  }

  // ---------- My rides (the same IndexedDB as ride.html and navigate.js) ----------
  const dbP = () => new Promise((resolve, reject) => {
    const r = indexedDB.open("trail-finder-rides", 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore("rides", { keyPath: "id" });
      db.createObjectStore("photos", { keyPath: "id" }).createIndex("rideId", "rideId");
      db.createObjectStore("current", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const allRides = async () => req((await dbP()).transaction("rides").objectStore("rides").getAll());
  const putRide = async (v) => { const t = (await dbP()).transaction("rides", "readwrite"); t.objectStore("rides").put(v); await new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error); }); };
  function metres(a, b) {
    const R = 6371008.8, rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // The same ride already in My rides: the same Strava id, or more than half of one overlapping the other in time.
  function already(have, a) {
    const s = Date.parse(a.start), e = s + (a.elapsed || a.moving || 0) * 1000;
    return have.some((r) => (r.imported && r.imported.strava === a.id) || Math.abs(r.start - s) < 60000 ||
      (r.end > r.start && e > s && Math.min(r.end, e) - Math.max(r.start, s) > 0.5 * Math.min(r.end - r.start, e - s)));
  }
  // A ride from Strava's track, thinned to Record ride's 5 m steps like an imported file.
  function rideOf(a, s) {
    const t0 = Date.parse(a.start), ll = s.latlng || [], tm = s.time || [], al = s.altitude || [], pts = [];
    let last = null;
    for (let i = 0; i < ll.length; i++) {
      if (!Array.isArray(ll[i]) || ll[i].length < 2) continue;
      last = [+(+ll[i][0]).toFixed(6), +(+ll[i][1]).toFixed(6), al[i] == null ? null : +(+al[i]).toFixed(1), t0 + (+tm[i] || 0) * 1000, null];
      if (!pts.length || metres(pts[pts.length - 1], last) >= MIN_STEP_M) pts.push(last);
    }
    if (last && pts[pts.length - 1] !== last) pts.push(last);
    if (pts.length < 2) return null;
    const start = pts[0][3], end = pts[pts.length - 1][3];
    return { id: "ride-" + start, start, end, points: pts, stats: STATS.statsOf(pts, start, end), saved: Date.now(),
      title: String(a.name || "Strava ride").slice(0, 120), description: "", cover: null, photoCount: 0,
      imported: { strava: a.id, at: Date.now() }, sport: String(a.sport || "").slice(0, 40) };
  }

  // ---------- the sync ----------
  // New rides since the newest one brought in (or the last 30 days), or with older: the 50 activities before the oldest.
  let busy = null;
  const sync = (older) => busy || (busy = run(older).finally(() => { busy = null; }));
  async function run(older) {
    let m = me();
    if (!m) return null;
    const now = Date.now() / 1000, after = m.newest ? m.newest - 3600 : now - FIRST_DAYS * 86400;
    const got = await call("list", older ? { before: m.oldest || now } : { after });
    const list = (got.rides || []).sort((a, b) => (Date.parse(a.start) - Date.parse(b.start)) * (older ? -1 : 1));
    const have = await allRides(), ids = [];
    let n = 0, skipped = 0, stopped = false;
    m = me() || m;
    for (const a of list) {
      const t = Date.parse(a.start) / 1000;
      if (already(have, a)) skipped++;
      else {
        if (n >= MAX_PER_SYNC) { stopped = true; break; }
        n++;
        const s = await call("streams", { id: a.id });
        const ride = rideOf(a, s);
        if (ride) { await putRide(ride); have.push(ride); ids.push(ride.id); }
      }
      if (older) m.oldest = Math.min(m.oldest || now, t); else m.newest = Math.max(m.newest || 0, t);
      keep(m);
    }
    if (older) {
      if (!stopped && got.oldest) m.oldest = Math.min(m.oldest || now, got.oldest);
      if (!stopped && (got.count || 0) < 50) m.done = true;
    } else if (!m.oldest) m.oldest = after;   // the first sync went back this far
    m.at = Date.now();
    keep(m);
    if (ids.length) window.dispatchEvent(new CustomEvent("tf:rides-imported", { detail: ids }));
    return { added: ids.length, skipped, more: stopped };
  }
  // Is this account connected? Asked on a device that doesn't know yet (at most every 6 hours), and after connecting.
  async function ask(force) {
    if (!acct.user) return null;
    const m = me();
    if (m && !force) return m;
    const asked = lsGet("tf:stravaAsked");
    if (!force && asked && asked.uid === acct.user.id && Date.now() - asked.at < ASK_MS) return null;
    lsSet("tf:stravaAsked", { uid: acct.user.id, at: Date.now() });
    const st = await call("status");
    if (!st.connected) { keep(null); return null; }
    const next = { ...(m || {}), uid: acct.user.id, athlete: st.athlete, scope: st.scope };
    keep(next);
    return next;
  }
  async function auto() {
    try {
      const m = await ask(false);
      if (m && Date.now() - (m.at || 0) > AUTO_MS) await sync(false);
    } catch (e) { console.warn("Strava sync:", e); }
    paint();
  }

  // ---------- the box in My rides ----------
  let note = "", noteWarn = false;
  const say = (t, warn) => { note = t; noteWarn = !!warn; paint(); };
  const fmtDay = (s) => new Date(s * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString(); };
  let box = null;
  if (box0) {
    const css = document.createElement("style");
    css.textContent = `
.strava { margin: 10px 0 4px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line, #d6dad3); }
.strava p { margin: 0 0 8px; }
.strava .btns { display: flex; flex-wrap: wrap; gap: 8px; }
.strava .btn.strava-go { background: #fc4c02; border-color: #fc4c02; color: #fff; }
.strava .hint { margin: 8px 0 0; }`;
    document.head.appendChild(css);
    box = document.createElement("div");
    box.className = "strava"; box.id = "stravaBox";
    box0.after(box);
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-s]");
      if (!b) return;
      const act = b.dataset.s;
      if (act === "in") { acct.open(); return; }
      b.disabled = true;
      try {
        if (act === "connect") {
          say("Opening Strava…");
          const r = await call("start", { back: location.origin + location.pathname });
          lsSet("tf:stravaPending", Date.now());
          location.href = r.url;    // in the iPhone app this opens Safari
          return;
        }
        if (act === "sync" || act === "older") {
          say(act === "older" ? "Getting older rides from Strava…" : "Checking Strava for new rides…");
          const r = await sync(act === "older");
          const m = me();
          say(!r ? "" : (r.added ? `Brought in ${r.added} ride${r.added > 1 ? "s" : ""}.` : act === "older" ? "No older rides there." : "No new rides.") +
            (r && r.more ? " More to come: tap again." : "") + (act === "older" && m && m.oldest ? ` My rides now go back to ${fmtDay(m.oldest)}.` : ""));
        }
        if (act === "off") {
          if (!confirm("Disconnect Strava? New Strava rides won't come in any more. Rides already in My rides stay.")) { b.disabled = false; return; }
          await call("disconnect");
          keep(null);
          say("Strava is disconnected.");
        }
      } catch (err) { say("Strava: " + (err && err.message ? err.message : err), true); }
      b.disabled = false;
    });
  }
  function paint() {
    if (!box) return;
    const m = me(), msg = note ? `<p class="hint${noteWarn ? " warn" : ""}" role="status">${esc(note)}</p>` : "";
    if (!acct.user) {
      box.innerHTML = `<p><b>Strava</b>: sign in to bring your Strava rides in on their own, on every device.</p><div class="btns"><button type="button" class="btn" data-s="in">Sign in</button></div>${msg}`;
      return;
    }
    if (!m) {
      box.innerHTML = `<p><b>Strava</b>: connect once and your Strava bike rides come into My rides on their own (the last 30 days first, older ones on request), with the trails you rode marked on the map.</p>
        <div class="btns"><button type="button" class="btn strava-go" data-s="connect">Connect Strava</button></div>${msg}`;
      return;
    }
    const noActs = m.scope && !/activity:read/.test(m.scope);
    box.innerHTML = `<p><b>Strava</b>: connected${m.athlete ? ` as ${esc(m.athlete)}` : ""}. New rides come in on their own when you open the app${m.at ? ` (checked ${ago(m.at)})` : ""}.</p>
      ${noActs ? `<p class="hint warn">Strava isn't sharing your rides: disconnect, connect again and leave "View data about your activities" ticked.</p>` : ""}
      <div class="btns"><button type="button" class="btn" data-s="sync">↻ Sync now</button>${m.done ? "" : `<button type="button" class="btn" data-s="older">Get older rides</button>`}<button type="button" class="btn danger" data-s="off">Disconnect</button></div>${msg}`;
  }

  // Back from Strava's consent page.
  async function finish() {
    if (back.error || !back.code || !back.state) { say(back.error === "access_denied" ? "Strava wasn't connected: you said no on Strava's page." : "Strava didn't connect. Try again.", true); return; }
    say("Connecting Strava…");
    try {
      const r = await call("connect", { code: back.code, state: back.state, scope: back.scope });
      lsSet("tf:stravaPending", null);
      if (!acct.user) { say(`Strava is connected${r.athlete ? ` (${r.athlete})` : ""}. Go back to the Trail Finder app: your rides come in there.`); return; }
      await ask(true);
      say("Strava is connected. Bringing in your rides from the last 30 days…");
      const s = await sync(false);
      say(s && s.added ? `Strava is connected: brought in ${s.added} ride${s.added > 1 ? "s" : ""}.${s.more ? " More come next time." : ""}` : "Strava is connected. No bike rides with GPS in the last 30 days.");
    } catch (e) { say("Strava: " + (e && e.message ? e.message : e), true); }
  }

  let started = false;
  const start = async () => {
    started = true;
    await acct.ready;
    paint();
    if (back) { await acct.load(); await finish(); }
    else auto();
  };
  // On the map page, after the first draw (app speed: start work waits); My rides right away.
  if (box) start();
  else addEventListener("load", () => setTimeout(start, 8000));
  window.addEventListener("tf:account", () => { paint(); if (started && acct.user && !back) auto(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !acct.user || !started) return;
    const pend = lsGet("tf:stravaPending");
    if (!me() && pend && Date.now() - pend < 30 * 60e3) ask(true).then(() => auto()).catch(() => {});   // connected in Safari
    else auto();
  });
  window.tfStrava = { sync, status: () => me() };
})();
