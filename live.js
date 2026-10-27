// Live location with friends and family: "📡 Share my live location" on the Ride (Track) page and in More, in every sport.
// - Start sharing sends where you are every 15 s to a group named by a random code, and gives you a link to send
//   (#live=<code>). Whoever opens it sees you on the map, with your name, the last hour of your track, how long ago
//   the phone last sent, and when you said you'd be back ("Overdue" in red once that time has passed). No sign-in.
// - Riding together: a friend who opened your link taps "Share mine too" and joins the same group, so everyone sees
//   everyone. Up to 20 people in a group.
// - The share stops by itself after the hours you picked (2 to 24), or with Stop sharing,
//   which takes your dot off everyone's map at once. The server forgets a dot 2 hours after its last update.
// - On the website, a phone only sends while Trail Finder is open on screen (web pages are paused when the phone
//   locks). In the iPhone app the app's own GPS keeps sending with the phone locked (TrailGps "live" in ios-app).
// Server side: supabase/live-share.sql (live_put / live_get / live_stop; the table itself is closed).
(() => {
  "use strict";
  const map = window.tfLeaflet;
  const acct = window.tfAccount;
  if (!map || !window.L || !acct || !acct.enabled) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Kept on this phone only (never synced to an account: the secret must stay on the phone that shares)
  const ls = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem("tf:" + k); else localStorage.setItem("tf:" + k, JSON.stringify(v)); } catch {} },
  };
  const rand = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[b % 57]).join(""); };
  const CODE_RE = /^[A-Za-z0-9_-]{12,40}$/;
  const SEND_MS = 15000, POLL_MS = 15000, STALE_MS = 10 * 60000;
  const sportNow = () => ["ski", "hunt", "fish", "moto"].find((s) => document.body.classList.contains("sport-" + s)) || "mtb";
  const SPORT_WORD = { mtb: "riding", ski: "skiing", hunt: "hunting", fish: "fishing", moto: "riding" };
  const linkOf = (grp) => `${location.origin}${location.pathname}#live=${grp}`;

  async function rpc(fn, args) {
    const r = await fetch(`${acct.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: acct.key, Authorization: `Bearer ${acct.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(/busy/.test(t) ? "Too many people sharing right now, try again later." : /not yours/.test(t) ? "This share belongs to another phone." : /live_put|function|schema/i.test(t) ? "Live location isn't set up on the server yet." : `The server said ${r.status}.`);
    }
    return r.status === 204 ? null : r.json();
  }

  const css = document.createElement("style");
  css.textContent = `
dialog.live { border: 1px solid var(--line); border-radius: 16px; background: var(--panel); color: var(--fg); padding: 16px; width: min(440px, calc(100vw - 32px)); max-height: min(80dvh, 640px); overflow: auto; box-sizing: border-box; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.live::backdrop { background: rgba(0,0,0,.4); }
dialog.live h2 { margin: 0 0 4px; font-family: var(--font-display); font-size: 1.25rem; padding-right: 36px; }
dialog.live .lv-x { position: absolute; top: 10px; right: 10px; font: inherit; font-size: 1.1rem; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
dialog.live p { margin: 6px 0; line-height: 1.35; }
dialog.live .lv-note { color: var(--muted); font-size: .84rem; }
dialog.live label { display: block; font-weight: 700; font-size: .85rem; margin: 10px 0 4px; }
dialog.live input, dialog.live select { font: inherit; font-size: 16px; width: 100%; box-sizing: border-box; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
dialog.live .lv-row { display: flex; gap: 8px; }
dialog.live .lv-row > * { flex: 1; min-width: 0; }
dialog.live .lv-go { display: block; width: 100%; margin-top: 14px; font: inherit; font-weight: 800; padding: 12px; border-radius: 12px; border: 0; background: var(--cta); color: var(--cta-fg); cursor: pointer; }
dialog.live .lv-btn { font: inherit; font-weight: 700; padding: 10px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip, transparent); color: var(--fg); cursor: pointer; }
dialog.live .lv-stop { width: 100%; margin-top: 10px; color: #c92a2a; }
dialog.live .lv-on { display: flex; align-items: center; gap: 8px; font-weight: 800; color: #2b8a3e; }
dialog.live .lv-on::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: #2b8a3e; animation: lvPulse 1.6s infinite; }
dialog.live .lv-link { font-size: .8rem; word-break: break-all; color: var(--muted); user-select: all; -webkit-user-select: all; }
dialog.live h3 { margin: 14px 0 4px; font-size: .74rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
dialog.live ul { list-style: none; margin: 0; padding: 0; }
dialog.live li button { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; font: inherit; padding: 8px 4px; border: 0; border-top: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
dialog.live li small { display: block; color: var(--muted); font-size: .8rem; }
dialog.live li .late { color: #c92a2a; font-weight: 700; }
dialog.live .lv-err { color: #c92a2a; font-weight: 700; }
.lv-pin { width: 30px; height: 30px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 1px 6px rgba(0,0,0,.45); color: #fff; font: 800 14px/24px system-ui, sans-serif; text-align: center; box-sizing: border-box; }
.lv-pin.stale { filter: grayscale(.8); opacity: .75; }
.lv-pin.late { border-color: #e03131; animation: lvRing 1.4s infinite; }
dialog.live .lv-pin { flex: none; }
.leaflet-tooltip.lv-name { font-weight: 800; padding: 1px 6px; border-radius: 8px; }
@keyframes lvPulse { 50% { opacity: .35; } }
@keyframes lvRing { 50% { box-shadow: 0 0 0 6px rgba(224,49,49,.35); } }
@media (prefers-reduced-motion: reduce) { dialog.live .lv-on::before, .lv-pin.late { animation: none; } }`;
  document.head.append(css);

  // ---------- my share ----------
  // me: { grp, id, secret, name, due (ms or null), until (ms), since (ms) } while sharing, else null
  let me = ls.get("liveShare", null);
  if (me && !(me.until > Date.now())) { me = null; ls.set("liveShare", null); }
  let watch = null, lastFix = null, lastSent = 0, sendErr = "", sending = false;
  const sharing = () => !!me;

  function startGps() {
    if (watch != null || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => { lastFix = p; send(true); }, () => {}, { enableHighAccuracy: true, maximumAge: 60000, timeout: 20000 });
    watch = navigator.geolocation.watchPosition((p) => { lastFix = p; send(); }, (e) => { if (e.code === 1) { sendErr = "Location is turned off for Trail Finder, so nothing is sent."; render(); } },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  }
  function stopGps() { if (watch != null) navigator.geolocation.clearWatch(watch); watch = null; }
  // The blue dot's fixes count too (it may already be watching)
  window.addEventListener("tf:you", (e) => { if (e.detail && !e.detail.compass) { lastFix = { coords: { latitude: e.detail.lat, longitude: e.detail.lon, accuracy: e.detail.acc || null, speed: null }, timestamp: Date.now() }; send(); } });

  async function send(force) {
    if (!me || !lastFix || sending) return;
    if (Date.now() > me.until) { stop(true); return; }
    if (!force && Date.now() - lastSent < SEND_MS) return;
    sending = true;
    const c = lastFix.coords;
    try {
      await rpc("live_put", {
        p_grp: me.grp, p_id: me.id, p_secret: me.secret, p_name: me.name, p_sport: sportNow(),
        p_lat: +c.latitude.toFixed(6), p_lon: +c.longitude.toFixed(6), p_acc: c.accuracy == null ? null : Math.round(c.accuracy),
        p_speed: c.speed == null ? null : +c.speed.toFixed(1), p_due: me.due ? new Date(me.due).toISOString() : null, p_until: new Date(me.until).toISOString(),
      });
      lastSent = Date.now(); sendErr = "";
    } catch (e) { sendErr = navigator.onLine === false ? "No signal: it sends again as soon as there is." : e.message; lastSent = Date.now() - SEND_MS / 2; }
    sending = false;
    render();
  }
  // In the iPhone app the app's GPS sends too, with the phone locked
  const CAP = window.Capacitor;
  const NATIVE = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform() && CAP.nativePromise && (CAP.PluginHeaders || []).some((h) => h.name === "TrailGps" && (h.methods || []).some((m) => m.name === "live")));
  function nativeLive() {
    if (!NATIVE) return;
    const args = me ? { url: `${acct.url}/rest/v1/rpc/live_put`, key: acct.key, grp: me.grp, id: me.id, secret: me.secret, name: me.name, sport: sportNow(), due: me.due || 0, until: me.until } : { grp: "" };
    CAP.nativePromise("TrailGps", "live", args).catch(() => {});
  }
  window.addEventListener("tf:sport", () => { if (me) { nativeLive(); send(true); } });

  function start({ name, dueMin, hours, grp }) {
    const now = Date.now();
    me = { grp: grp && CODE_RE.test(grp) ? grp : rand(16), id: rand(12), secret: rand(32), name: (name || "").trim().slice(0, 40) || "Me",
      due: dueMin ? now + dueMin * 60000 : null, until: now + hours * 3600000, since: now };
    ls.set("liveShare", me); ls.set("liveName", me.name);
    addGroup(me.grp);
    lastSent = 0; sendErr = "";
    startGps(); nativeLive();
    if (lastFix) send(true);
    poll();
    syncCards();
  }
  async function stop(quiet) {
    const was = me;
    me = null; ls.set("liveShare", null);
    stopGps(); nativeLive();
    syncCards();
    if (was) rpc("live_stop", { p_grp: was.grp, p_id: was.id, p_secret: was.secret }).catch(() => {});
    if (!quiet && window.tfToast) window.tfToast("Stopped sharing your location");
    render(); poll();
  }
  if (me) { startGps(); nativeLive(); }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { if (me) send(true); poll(); } });

  // ---------- the people I can see ----------
  // groups: [{ grp, at }] links I opened (and my own group); dropped a day after the last time I looked
  let groups = (ls.get("liveGroups", []) || []).filter((g) => g && CODE_RE.test(g.grp) && Date.now() - g.at < 24 * 3600000);
  function addGroup(grp) {
    groups = groups.filter((g) => g.grp !== grp);
    groups.unshift({ grp, at: Date.now() });
    groups = groups.slice(0, 5);
    ls.set("liveGroups", groups);
  }
  function dropGroup(grp) { groups = groups.filter((g) => g.grp !== grp); ls.set("liveGroups", groups); people = people.filter((p) => p.grp !== grp); draw(); render(); }
  let people = [];   // [{ grp, id, name, sport, lat, lon, acc, due, until, track, updated_at }]
  let pollT = 0, polling = false;
  async function poll() {
    clearTimeout(pollT);
    if (!groups.length) { people = []; draw(); return; }
    if (document.visibilityState !== "visible" || polling) { pollT = setTimeout(poll, POLL_MS); return; }
    polling = true;
    const got = [];
    await Promise.all(groups.map(async (g) => {
      try { const rows = await rpc("live_get", { p_grp: g.grp }); (rows || []).forEach((r) => got.push({ ...r, grp: g.grp })); g.ok = true; }
      catch (e) { g.err = e.message; people.filter((p) => p.grp === g.grp).forEach((p) => got.push(p)); }
    }));
    polling = false;
    people = got.filter((p) => !(me && p.grp === me.grp && p.id === me.id));
    draw(); render();
    pollT = setTimeout(poll, POLL_MS);
  }

  // ---------- on the map ----------
  map.createPane("livePane").style.zIndex = 655;   // over the trails and other pins
  const layer = L.layerGroup().addTo(map);
  const COLOURS = ["#1c7ed6", "#e8590c", "#7048e8", "#0ca678", "#d6336c", "#f59f00", "#1098ad", "#5c940d"];
  const colourOf = (id) => COLOURS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLOURS.length];
  const ago = (t) => { const m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
  const clock = (ms) => new Date(ms).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])\.?m\.?/i, " $1m");
  const late = (p) => p.due && Date.parse(p.due) < Date.now();
  const stale = (p) => Date.now() - Date.parse(p.updated_at) > STALE_MS;
  function pinHtml(p) { return `<div class="lv-pin${late(p) ? " late" : stale(p) ? " stale" : ""}" style="background:${colourOf(p.id)}">${esc((p.name || "?").trim().charAt(0).toUpperCase() || "?")}</div>`; }
  function statusOf(p) {
    const bits = [`seen ${ago(p.updated_at)}`];
    if (p.speed != null && p.speed > 1.5 && !stale(p)) bits.push(`${Math.round(p.speed * 3.6)} km/h`);
    if (p.due) bits.push(late(p) ? `<span class="late">overdue by ${ago(p.due).replace(" ago", "")}</span>` : `back by ${clock(Date.parse(p.due))}`);
    return bits.join(" · ");
  }
  function draw() {
    layer.clearLayers();
    people.forEach((p) => {
      const col = colourOf(p.id), tr = (p.track || []).map((q) => [q[0], q[1]]);
      if (tr.length > 1) L.polyline(tr, { pane: "livePane", color: col, weight: 4, opacity: 0.75, dashArray: "1 7", lineCap: "round", interactive: false }).addTo(layer);
      L.marker([p.lat, p.lon], { pane: "livePane", icon: L.divIcon({ className: "", html: pinHtml(p), iconSize: [30, 30], iconAnchor: [15, 15] }), keyboard: false })
        .bindTooltip(esc(p.name || "Someone"), { permanent: true, direction: "top", offset: [0, -14], className: "lv-name" })
        .on("click", () => open())
        .addTo(layer);
    });
  }
  function showAll() {
    if (!people.length) return;
    const b = L.latLngBounds(people.map((p) => [p.lat, p.lon]));
    if (people.length === 1) map.setView(b.getCenter(), Math.max(map.getZoom(), 14));
    else map.fitBounds(b.pad(0.3), { maxZoom: 15 });
  }

  // ---------- the dialog ----------
  let dlg = null;
  function open() {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "live";
      dlg.addEventListener("click", onClick);
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
      document.body.append(dlg);
    }
    render(true);
    if (!dlg.open) dlg.showModal();
    poll();
  }
  function peopleHtml() {
    if (!people.length) return groups.length ? `<h3>On the map</h3><p class="lv-note">Nobody else is sharing in ${groups.length > 1 ? "these groups" : "this group"} right now.</p>` : "";
    return `<h3>On the map</h3><ul>${people.map((p) => `<li><button type="button" data-go="${esc(p.grp)}|${esc(p.id)}">${pinHtml(p)}<span><b>${esc(p.name || "Someone")}</b>${p.sport && SPORT_WORD[p.sport] ? ` <small style="display:inline">${SPORT_WORD[p.sport]}</small>` : ""}<small>${statusOf(p)}</small></span></button></li>`).join("")}</ul>`;
  }
  // A full redraw while typing the name or picking a time would be annoying: the status waits until then.
  function render(full) {
    if (!dlg || !dlg.open && !full) return;
    if (!full && document.activeElement && document.activeElement.closest && document.activeElement.closest("dialog.live select, dialog.live input")) return;
    const friendGrp = !me && groups.find((g) => people.some((p) => p.grp === g.grp));
    let h = `<button type="button" class="lv-x" data-a="close" aria-label="Close">✕</button><h2>Live location</h2>`;
    if (me) {
      const sent = lastSent ? `last sent ${ago(new Date(lastSent).toISOString())}` : "waiting for your location…";
      h += `<p class="lv-on">Sharing your location</p>
        <p class="lv-note">Since ${clock(me.since)}, ${sent}. Stops by itself at ${clock(me.until)}${me.due ? `. Back by ${clock(me.due)}` : ""}.</p>
        ${sendErr ? `<p class="lv-err">${esc(sendErr)}</p>` : ""}
        <p>Send this link to the people who should see you:</p>
        <div class="lv-row"><button type="button" class="lv-btn" data-a="send">↗ Send the link</button><button type="button" class="lv-btn" data-a="copy">Copy</button></div>
        <p class="lv-link">${esc(linkOf(me.grp))}</p>
        <p class="lv-note">${NATIVE ? "It keeps sending with the phone locked." : "It sends while Trail Finder is open on your screen. In the iPhone app it keeps sending with the phone locked."}</p>
        ${peopleHtml()}
        <button type="button" class="lv-btn lv-stop" data-a="stop">Stop sharing</button>`;
    } else {
      const name = ls.get("liveName", "");
      h += `<p>Friends and family see where you are on a map, from a link you send them. They don't need the app.</p>
        ${peopleHtml()}
        <label for="lvName">Your name</label><input id="lvName" maxlength="40" autocomplete="given-name" placeholder="What they'll see on the map" value="${esc(name)}">
        <div class="lv-row"><div><label for="lvDue">Back by</label><select id="lvDue"><option value="0">Not set</option>${[60, 120, 180, 240, 360, 480].map((m) => `<option value="${m}">${clock(Date.now() + m * 60000)} (${m / 60} h)</option>`).join("")}</select></div>
        <div><label for="lvHours">Stop sharing after</label><select id="lvHours"><option value="2">2 hours</option><option value="4">4 hours</option><option value="8">8 hours</option><option value="12" selected>12 hours</option><option value="24">All day (24 h)</option></select></div></div>
        <p class="lv-note">With a "Back by" time, they see "Overdue" in red if you're not back.</p>
        ${friendGrp ? `<button type="button" class="lv-go" data-a="start" data-grp="${esc(friendGrp.grp)}">📡 Share mine with them too</button><button type="button" class="lv-btn" style="width:100%;margin-top:8px" data-a="start">Start my own share</button>`
          : `<button type="button" class="lv-go" data-a="start">📡 Start sharing</button>`}
        ${groups.length ? `<p class="lv-note" style="margin-top:12px"><button type="button" class="lv-btn" data-a="forget">Stop showing friends' locations</button></p>` : ""}`;
    }
    const keep = dlg.querySelector("#lvName"), kept = keep ? keep.value : null, focus = document.activeElement === keep;
    dlg.innerHTML = h;
    if (kept != null && dlg.querySelector("#lvName")) { dlg.querySelector("#lvName").value = kept; if (focus) dlg.querySelector("#lvName").focus(); }
  }
  function onClick(e) {
    const b = e.target.closest("button");
    if (!b) return;
    const a = b.dataset.a;
    if (a === "close") dlg.close();
    else if (a === "start") {
      if (!navigator.geolocation) { sendErr = "This browser can't share its location."; return; }
      start({ name: dlg.querySelector("#lvName").value, dueMin: +dlg.querySelector("#lvDue").value, hours: +dlg.querySelector("#lvHours").value, grp: b.dataset.grp });
      render(true);
    } else if (a === "stop") stop();
    else if (a === "send" && me) {
      const word = SPORT_WORD[sportNow()];
      if (window.tfShare) window.tfShare({ title: "My live location", text: `${me.name} is ${word}. See where I am${me.due ? `, back by ${clock(me.due)}` : ""}:`, url: linkOf(me.grp) });
    } else if (a === "copy" && me) {
      const done = () => window.tfToast && window.tfToast("Link copied");
      if (navigator.clipboard) navigator.clipboard.writeText(linkOf(me.grp)).then(done, () => {});
    } else if (a === "forget") { groups.slice().forEach((g) => dropGroup(g.grp)); }
    else if (b.dataset.go) {
      const [grp, id] = b.dataset.go.split("|"), p = people.find((x) => x.grp === grp && x.id === id);
      if (p) { dlg.close(); map.setView([p.lat, p.lon], Math.max(map.getZoom(), 15)); }
    }
  }

  // ---------- the cards on the Ride and More pages (index.html hubHtml) ----------
  function syncCards() {
    document.querySelectorAll('.hub-card[data-hub="live"]').forEach((c) => {
      const s = c.querySelector("small"), more = /^Live/.test(c.querySelector("b").textContent);
      if (s) s.textContent = me ? "On now: tap to send the link or stop" : more ? "Share where you are, or see friends who share" : "Friends and family see where you are";
    });
  }

  // ---------- a link someone sent: #live=<code> ----------
  function fromHash() {
    const m = location.hash.match(/^#live=([A-Za-z0-9_-]{12,40})$/);
    if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    addGroup(m[1]);
    rpc("live_get", { p_grp: m[1] }).then((rows) => {
      people = people.filter((p) => p.grp !== m[1]).concat((rows || []).map((r) => ({ ...r, grp: m[1] }))).filter((p) => !(me && p.grp === me.grp && p.id === me.id));
      draw();
      if (rows && rows.length) { showAll(); if (window.tfToast) window.tfToast(rows.length === 1 ? `Showing ${rows[0].name || "their"} live location` : `Showing ${rows.length} people's live locations`); }
      else open();
      poll();
    }, (e) => { if (window.tfToast) window.tfToast(`Couldn't load the live location: ${e.message}`); });
  }
  window.addEventListener("hashchange", fromHash);
  setTimeout(fromHash, 800);   // after the map has its first view
  if (groups.length) setTimeout(poll, 1500);

  window.tfLive = { open, sharing, showAll };
})();
