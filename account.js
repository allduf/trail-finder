// Optional sign-in for Trail Finder (Supabase). Nobody has to sign in: the whole app works without it.
// Signed-in riders get their settings and rides saved to their account, so they follow them to any device.
// The page loads this file; it adds a "Sign in" button to elements marked data-account-slot.
// Pages listen for "tf:account" (fires with detail = user or null) and use window.tfAccount.
(() => {
  // From the Supabase project (Project Settings → API). The anon key is meant to be public; the
  // database only lets each rider read and write their own rows (see supabase/setup.sql).
  const SUPABASE_URL = "https://fohdmserpbkurcvcrbbb.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_kzmEvM2ENCwNcH7-Nu-pOA_88II-bhX";
  const LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.99.3/dist/umd/supabase.js";

  // Settings saved to the account: the tf:* localStorage keys the pages remember.
  // Not "map3d": 3D turned on at a computer would open a phone straight into 3D, which can run it out of memory.
  const SETTINGS = ["months", "colorBy", "allTrails", "prime", "zone", "basemap4", "nearKm", "track", "nameNear", "mode", "nameZone", "want", "folders", "notify", "notifyRead", "toride", "riddenMap", "loamAlert", "loamNew", "loamRide", "loamArea", "notifyNew", "planGone", "planSaved", "recentTrails"];
  const STAMP = "tf:settingsAt";   // when this device last changed a setting (ms)

  const api = window.tfAccount = { enabled: !!(SUPABASE_URL && SUPABASE_ANON_KEY), url: SUPABASE_URL, key: SUPABASE_ANON_KEY, client: null, user: null, ready: null };
  if (!api.enabled) { api.ready = Promise.resolve(null); return; }

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  // ---------- button and sign-in box ----------
  const css = document.createElement("style");
  css.textContent = `
.acct-btn.acct-btn { display: inline-flex; align-items: center; gap: 5px; border: 1.5px solid var(--accent); border-radius: 999px; padding: 3px 11px; margin-left: 4px; }
.acct-btn .acct-dot { width: 20px; height: 20px; border-radius: 50%; background: var(--accent); color: var(--accent-fg, #fff); font-size: .72rem; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; text-transform: uppercase; }
dialog.acct, dialog.acct * { box-sizing: border-box; }
dialog.acct { overflow-x: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 18px; width: min(380px, calc(100vw - 32px)); box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.acct::backdrop { background: rgba(0,0,0,.4); }
dialog.acct h2 { margin: 0 0 6px; font-family: var(--font-display); font-size: 1.35rem; text-transform: uppercase; letter-spacing: .02em; }
dialog.acct p { margin: 0 0 12px; color: var(--muted); font-size: .92rem; }
dialog.acct input { width: 100%; font: inherit; padding: 10px 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); margin-bottom: 10px; }
dialog.acct .acct-row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
dialog.acct button { font: inherit; font-weight: 600; padding: 9px 14px; border-radius: 9px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
dialog.acct button.go { background: var(--accent); color: var(--accent-fg, #fff); border-color: transparent; }
dialog.acct button:disabled { opacity: .6; cursor: default; }
dialog.acct .acct-msg { min-height: 1.2em; font-size: .88rem; margin: 0 0 10px; color: var(--fg); }
dialog.acct .acct-msg.err { color: #c0392b; }
dialog.acct .acct-alt { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 12px; font-size: .88rem; }
dialog.acct .acct-alt button { background: none; border: 0; padding: 2px 0; color: var(--accent); font-weight: 600; }
dialog.acct .acct-menu { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
dialog.acct .acct-menu button { text-align: left; padding: 12px 14px; font-size: 1rem; }
dialog.acct .acct-menu small { display: block; font-weight: 400; color: var(--muted); font-size: .82rem; margin-top: 2px; }
dialog.acct label { display: block; font-size: .8rem; font-weight: 600; color: var(--muted); margin-bottom: 3px; }`;
  document.head.appendChild(css);

  const box = document.createElement("dialog");
  box.className = "acct";
  box.innerHTML = `
<form method="dialog" id="acctIn">
  <h2>Sign in</h2>
  <p>Optional. Signing in saves your settings and rides to your account so they're on every device. Everything else works the same without it.</p>
  <label for="acctEmail">Email</label>
  <input type="email" id="acctEmail" placeholder="you@example.com" autocomplete="email" required>
  <label for="acctPass">Password</label>
  <input type="password" id="acctPass" autocomplete="current-password" minlength="6">
  <p class="acct-msg" id="acctMsg" role="status"></p>
  <div class="acct-row"><button type="button" data-close>Not now</button><button type="submit" class="go" id="acctSend">Sign in</button></div>
  <div class="acct-alt"><button type="button" id="acctNew">New here? Create an account</button><button type="button" id="acctLink">Forgot password? Email me a link</button></div>
</form>
<div id="acctOut" hidden>
  <div id="acctMenu">
    <h2>Your account</h2>
    <p>Signed in as <strong id="acctWho"></strong>. Your settings, rides and trail folders are saved to your account.</p>
    <p class="acct-msg" id="acctSync" role="status"></p>
    <div class="acct-menu">
      <button type="button" id="acctGoFolders"><span aria-hidden="true">📁</span> My trails<small>To ride, Ridden, your folders, saved routes and rides</small></button>
      <button type="button" id="acctGoSettings"><span aria-hidden="true">⚙️</span> Settings<small>Email, password, sign out</small></button>
    </div>
    <div class="acct-row"><button type="button" class="go" data-close>Done</button></div>
  </div>
  <div id="acctSettings" hidden>
    <h2>Settings</h2>
    <p class="acct-msg" id="acctSetMsg" role="status"></p>
    <label for="acctNewEmail">Email</label>
    <input type="email" id="acctNewEmail" autocomplete="email">
    <div class="acct-row" style="margin-bottom:12px"><button type="button" id="acctSetEmail">Change email</button></div>
    <label for="acctNewPass">New password</label>
    <input type="password" id="acctNewPass" autocomplete="new-password" minlength="6" placeholder="At least 6 characters">
    <div class="acct-row" style="margin-bottom:12px"><button type="button" id="acctSetPass">Save password</button></div>
    <div class="acct-row"><button type="button" id="acctBack">← Back</button><button type="button" id="acctSignOut">Sign out</button></div>
  </div>
</div>`;
  document.body.appendChild(box);
  const q = (id) => box.querySelector("#" + id);
  box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => box.close()));
  box.addEventListener("click", (e) => { if (e.target === box) box.close(); });

  const buttons = [];
  document.querySelectorAll("[data-account-slot]").forEach((slot) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "linkish acct-btn";
    b.addEventListener("click", openBox);
    slot.appendChild(b); buttons.push(b);
  });
  function paintButtons() {
    buttons.forEach((b) => {
      if (api.user) { b.innerHTML = `<span class="acct-dot" aria-hidden="true"></span>Account`; b.querySelector(".acct-dot").textContent = (api.user.email || "?")[0]; b.title = api.user.email || ""; }
      else { b.textContent = "Sign in"; b.title = "Optional: save your settings and rides to an account"; }
    });
  }
  paintButtons();
  function openBox() {
    api.load();
    q("acctIn").hidden = !!api.user; q("acctOut").hidden = !api.user;
    if (api.user) { q("acctWho").textContent = api.user.email || ""; showSettings(false); }
    else { q("acctMsg").textContent = ""; q("acctMsg").className = "acct-msg"; }
    if (!box.open) box.showModal();
  }
  function showSettings(on) {
    q("acctMenu").hidden = on; q("acctSettings").hidden = !on;
    if (on) { q("acctNewEmail").value = api.user.email || ""; q("acctSetMsg").textContent = ""; }
  }
  q("acctGoSettings").addEventListener("click", () => showSettings(true));
  q("acctBack").addEventListener("click", () => showSettings(false));
  // The map page shows the folders (index.html listens for "tf:open-folders"); other pages go there.
  q("acctGoFolders").addEventListener("click", () => {
    box.close();
    const ev = new CustomEvent("tf:open-folders", { detail: { handled: false } });
    window.dispatchEvent(ev);
    if (!ev.detail.handled) location.href = "./#folders";
  });
  api.open = openBox;
  api.setSyncNote = (text) => { q("acctSync").textContent = text || ""; };

  // ---------- Supabase ----------
  // The sign-in library is about 170 KB, so it loads only when it's needed: a saved sign-in on this device, a sign-in
  // link just opened, or the rider opening the sign-in box or a trail's reports (api.load). Signed-out visits skip it.
  let libLoad = null;
  api.load = () => libLoad || (libLoad = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = LIB;
    s.onload = async () => {
      try {
        api.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
        const { data } = await api.client.auth.getSession();
        setUser(data.session ? data.session.user : null);
        api.client.auth.onAuthStateChange((_ev, session) => setUser(session ? session.user : null));
      } catch (e) { console.warn("Sign-in unavailable:", e); }
      resolve(api.user);
    };
    s.onerror = () => { buttons.forEach((b) => { b.hidden = true; }); resolve(null); };
    document.head.appendChild(s);
  }));
  const savedSession = !!lsGet(`sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`);
  api.savedSession = savedSession;   // signed in on this device, even with no signal (reports.js keeps reports for later)
  const fromLink = /[#&?](access_token|code|error_description)=/.test(location.href);
  api.ready = savedSession || fromLink ? api.load() : Promise.resolve(null);

  function setUser(user) {
    const was = api.user ? api.user.id : null, now = user ? user.id : null;
    api.user = user;
    paintButtons();
    if (was === now) return;
    if (!was && now && box.open) openBox();
    if (now) api.sync();
    window.dispatchEvent(new CustomEvent("tf:account", { detail: user }));
  }

  function say(text, err) { const m = q("acctMsg"); m.textContent = text; m.className = "acct-msg" + (err ? " err" : ""); }
  async function creds() {
    const email = q("acctEmail").value.trim(), password = q("acctPass").value;
    await api.load();
    if (!api.client) { say("Sign-in isn't available right now. Try again later.", true); return null; }
    if (!q("acctEmail").reportValidity()) return null;
    return { email, password };
  }
  const redirect = () => location.origin + location.pathname;
  q("acctIn").addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = await creds(); if (!c) return;
    if (!c.password) { say("Enter your password, or use \u201cEmail me a link\u201d.", true); return; }
    q("acctSend").disabled = true; say("Signing in…");
    const { error } = await api.client.auth.signInWithPassword(c);
    q("acctSend").disabled = false;
    if (error) say(/invalid/i.test(error.message) ? "Wrong email or password. New here? Create an account below." : error.message, true);
    else box.close();
  });
  q("acctNew").addEventListener("click", async () => {
    const c = await creds(); if (!c) return;
    if (c.password.length < 6) { say("Pick a password of at least 6 characters, then tap Create an account.", true); q("acctPass").focus(); return; }
    say("Creating your account…");
    const { data, error } = await api.client.auth.signUp({ ...c, options: { emailRedirectTo: redirect() } });
    if (error) say(error.message, true);
    else if (data.session) box.close();
    else say(`Almost done: check ${c.email} and tap the link once to confirm. After that, sign in with your password.`);
  });
  q("acctLink").addEventListener("click", async () => {
    const c = await creds(); if (!c) return;
    say("Sending…");
    const { error } = await api.client.auth.signInWithOtp({ email: c.email, options: { emailRedirectTo: redirect() } });
    if (error) say(error.message, true);
    else say(`Check ${c.email} and tap the link. Once you're in, you can set a new password under Account.`);
  });
  const setMsg = (text) => { q("acctSetMsg").textContent = text; };
  q("acctSetPass").addEventListener("click", async () => {
    const pw = q("acctNewPass").value;
    if (pw.length < 6) { setMsg("Passwords need at least 6 characters."); return; }
    const { error } = await api.client.auth.updateUser({ password: pw });
    q("acctNewPass").value = "";
    setMsg(error ? "Couldn't save the password: " + error.message : "Password saved. Next time, sign in with your email and password.");
  });
  q("acctSetEmail").addEventListener("click", async () => {
    const email = q("acctNewEmail").value.trim();
    if (!q("acctNewEmail").reportValidity() || !email || email === api.user.email) return;
    const { error } = await api.client.auth.updateUser({ email }, { emailRedirectTo: redirect() });
    setMsg(error ? "Couldn't change the email: " + error.message : `Check ${email} (and your old address) and tap the confirm links. The change happens after that.`);
  });
  q("acctSignOut").addEventListener("click", async () => {
    window.dispatchEvent(new CustomEvent("tf:signing-out", { detail: api.user }));
    await api.client.auth.signOut();
    box.close();
  });

  // ---------- settings ----------
  // Each device stamps every setting it changes (tf:settingsKeyAt), and a sync merges key by key: the newer change
  // wins, so changing the map style on the phone no longer wipes a route just saved on the computer. Saved routes
  // merge both devices' lists (deleted ones are remembered in tf:planGone). Syncs run on sign-in, after a change,
  // when the app comes back to the screen, and when a page asks (tfAccount.sync(), e.g. opening 📂 Saved).
  const KEYAT = "tf:settingsKeyAt";
  const LIVE = new Set(["planSaved", "planGone", "notifyRead", "loamAlert"]);   // read fresh by the page, so no reload
  const jparse = (v, d) => { try { const x = JSON.parse(v); return x == null ? d : x; } catch { return d; } };
  const MERGE = {
    planGone: (a, b) => {
      const all = {};
      [...jparse(a, []), ...jparse(b, [])].forEach((g) => { if (g && g.id && !(all[g.id] >= g.at)) all[g.id] = g.at || 0; });
      const list = Object.entries(all).map(([id, at]) => ({ id, at })).sort((x, y) => y.at - x.at || (x.id < y.id ? -1 : 1)).slice(0, 300);
      return list.length ? JSON.stringify(list) : null;
    },
    planSaved: (a, b, out) => {
      const gone = new Set(jparse(out.planGone, []).map((g) => g.id)), all = {};
      const when = (e) => e.ed || Date.parse(e.at) || 0;
      [...jparse(a, []), ...jparse(b, [])].forEach((e) => { if (e && e.id && !gone.has(e.id) && (!all[e.id] || when(e) > when(all[e.id]))) all[e.id] = e; });
      const list = Object.values(all).sort((x, y) => (Date.parse(y.at) || 0) - (Date.parse(x.at) || 0) || (x.id < y.id ? -1 : 1));
      return list.length ? JSON.stringify(list) : null;
    },
  };
  function localSettings() {
    const data = {};
    SETTINGS.forEach((k) => { const v = lsGet("tf:" + k); if (v != null) data[k] = v; });
    return data;
  }
  const keyAts = () => jparse(lsGet(KEYAT), null);
  // First run with per-key stamps: this device's settings count as changed when it last changed anything.
  if (!keyAts()) { const at = +(lsGet(STAMP) || 0), o = {}; Object.keys(localSettings()).forEach((k) => { o[k] = at; }); lsSet(KEYAT, JSON.stringify(o)); }
  let snap = localSettings(), pushTimer = null, lastSync = 0, firstSync = true;
  window.addEventListener("tf:setting", () => {
    const now = Date.now(), cur = localSettings(), at = keyAts() || {};
    SETTINGS.forEach((k) => { if (cur[k] !== snap[k]) at[k] = now; });
    snap = cur;
    lsSet(KEYAT, JSON.stringify(at)); lsSet(STAMP, String(now));
    if (!api.user) return;
    clearTimeout(pushTimer); pushTimer = setTimeout(api.sync, 1500);
  });
  let syncing = null;
  // api.syncState: { at (ms, last good sync), error (text, last sync failed), routes (saved routes on the account) },
  // shown by 📂 Saved so a rider can see whether the account answered. A sync that hangs (a phone waking up) gives up
  // after 20 s, so the next one can run.
  api.syncState = { at: 0, error: "", routes: null };
  const syncSay = (o) => { Object.assign(api.syncState, o); window.dispatchEvent(new CustomEvent("tf:sync-state", { detail: api.syncState })); };
  let again = false;   // a change made while a sync was running goes up in one more sync right after
  api.sync = () => { if (syncing) { again = true; return syncing; } return runSync(); };
  const runSync = () => (syncing = Promise.race([doSync(), new Promise((_, no) => setTimeout(() => no(new Error("your account didn't answer")), 20000))])
    .catch((e) => { console.warn("Couldn't sync settings:", e); syncSay({ error: (e && e.message) || String(e) }); return false; })
    .finally(() => { syncing = null; if (again) { again = false; setTimeout(api.sync, 500); } }));
  async function doSync() {
    if (!api.user || !api.client) return false;
    lastSync = Date.now();
    const { data: row, error } = await api.client.from("settings").select("data, updated_at").eq("user_id", api.user.id).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) { console.warn("Couldn't load settings:", error.message); syncSay({ error: error.message }); return false; }
    const local = localSettings(), lat = keyAts() || {}, rdata = (row && row.data) || {}, rat = rdata._at || null;
    const rAll = row ? Date.parse(row.updated_at) || 0 : 0;   // rows saved before per-key stamps: all keys at the row's time
    const out = {}, outAt = {}, changed = [];
    let push = !row;
    SETTINGS.forEach((k) => {
      const lv = local[k] == null ? null : local[k], rv = rdata[k] == null ? null : String(rdata[k]);
      const la = lat[k] || 0, ra = rat ? rat[k] || 0 : rv != null ? rAll : 0;
      const v = MERGE[k] ? MERGE[k](lv, rv, out) : ra > la ? rv : lv;
      if (v !== lv) { lsSet("tf:" + k, v); changed.push(k); }
      if (v !== rv || (rat && (rat[k] || 0) !== Math.max(la, ra))) push = true;
      if (v != null) out[k] = v;
      if (Math.max(la, ra)) outAt[k] = Math.max(la, ra);
    });
    if (!rat && row) push = true;
    lsSet(KEYAT, JSON.stringify(outAt));
    snap = localSettings();
    let saveErr = "";
    if (push) {
      const { error: e2 } = await api.client.from("settings").upsert({ user_id: api.user.id, data: { ...out, _at: outAt }, updated_at: new Date().toISOString() });
      if (e2) { console.warn("Couldn't save settings:", e2.message); saveErr = e2.message; }
    }
    const first = firstSync; firstSync = false;
    if (changed.length) window.dispatchEvent(new CustomEvent("tf:settings-synced", { detail: changed }));
    // The map page reads most settings once at start, so on the first sync after opening it reloads to show the
    // account's settings. Later syncs never reload (the rider is using the page); lists like saved routes update live.
    if (first && changed.some((k) => !LIVE.has(k)) && document.documentElement.dataset.accountReload === "settings") location.reload();
    if (saveErr) { syncSay({ error: saveErr }); return false; }
    syncSay({ at: Date.now(), error: "", routes: jparse(out.planSaved, []).length });
    return true;
  }
  // Coming back to the app (phones keep it open for days): pick up what other devices changed.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && api.user && Date.now() - lastSync > 15000) api.sync(); });
})();
