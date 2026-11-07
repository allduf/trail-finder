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
  const SETTINGS = ["months", "colorBy", "allTrails", "prime", "zone", "basemap4", "nearKm", "track", "nameNear", "mode", "nameZone", "want", "folders", "notify", "notifyRead", "toride", "riddenMap", "loamAlert", "loamNew", "loamRide", "loamArea", "notifyNew", "planGone", "planSaved", "recentTrails", "myFinds", "shareOn", "shareKey", "sharePast", "shareFrom", "sharePlaces", "newsSeen",
    // What each sport saves (alex 2026-10-30: trips, spots and pins on the account in every sport). Pins and tracks have
    // their own tables (ski-points.js, ride.html); these are the lists kept in localStorage. listGone comes first: the
    // lists' merges read it.
    "listGone", "skiTrips", "skiTours", "skiWatch", "avyAlert", "fishAlert", "huntAlarms", "motoRoutes", "motoBikes", "motoBike", "hikeSaved", "hikePlans"];
  const STAMP = "tf:settingsAt";   // when this device last changed a setting (ms)

  const api = window.tfAccount = { enabled: !!(SUPABASE_URL && SUPABASE_ANON_KEY), url: SUPABASE_URL, key: SUPABASE_ANON_KEY, client: null, user: null, ready: null };
  // A list item deleted on this device (tf:listGone, { k: list key, id, at }), so the next sync doesn't bring it back
  // from the account. Pages call it before writing the list without the item (that write fires "tf:setting").
  api.gone = (k, ids) => {
    try {
      const at = Date.now(), l = JSON.parse(localStorage.getItem("tf:listGone") || "[]") || [];
      [].concat(ids).forEach((id) => l.unshift({ k, id: String(id), at }));
      localStorage.setItem("tf:listGone", JSON.stringify(l.slice(0, 300)));
    } catch {}
  };
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
dialog.acct button.danger { background: #c0392b; color: #fff; border-color: transparent; }
dialog.acct .acct-alt a { color: var(--accent); font-weight: 600; padding: 2px 0; }
dialog.acct .acct-alt button.acct-del { color: #c0392b; }
dialog.acct .acct-code { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
dialog.acct #acctCode { font-size: 1.3rem; letter-spacing: .25em; text-align: center; }
.acct-nudge, .acct-nudge * { box-sizing: border-box; }
.acct-nudge { position: fixed; left: 50%; bottom: calc(84px + env(safe-area-inset-bottom, 0px)); transform: translate(-50%, 16px); z-index: 2400; width: min(380px, calc(100vw - 32px));
  background: var(--panel); color: var(--fg); border: 1px solid var(--line); border-radius: 14px; padding: 14px; box-shadow: 0 8px 28px rgba(0,0,0,.28); opacity: 0; transition: opacity .2s, transform .2s; font: inherit; }
.acct-nudge.on { opacity: 1; transform: translate(-50%, 0); }
.acct-nudge p { margin: 0 0 10px; font-size: .9rem; color: var(--muted); line-height: 1.35; }
.acct-nudge strong { display: block; color: var(--fg); font-size: 1rem; margin-bottom: 2px; }
.acct-nudge .acct-row { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
.acct-nudge button { margin: 0; min-height: 40px; line-height: 1.2; font: inherit; font-weight: 600; padding: 8px 14px; border-radius: 9px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
.acct-nudge button.go { background: var(--accent); color: var(--accent-fg, #fff); border-color: transparent; }
dialog.acct label { display: block; font-size: .8rem; font-weight: 600; color: var(--muted); margin-bottom: 3px; }
dialog.acct .acct-out-row { justify-content: space-between; align-items: center; }
.acct-toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(84px + env(safe-area-inset-bottom, 0px)); z-index: 3000; width: min(420px, calc(100vw - 32px)); box-sizing: border-box; background: var(--panel, #fff); color: var(--fg, #111); border: 1px solid var(--line, #ccc); border-radius: 12px; padding: 12px 14px; box-shadow: 0 8px 30px rgba(0,0,0,.25); font-size: .92rem; }`;
  document.head.appendChild(css);

  const box = document.createElement("dialog");
  box.className = "acct";
  box.innerHTML = `
<form method="dialog" id="acctIn">
  <h2 id="acctHead">Sign in</h2>
  <p id="acctNeed" hidden></p>
  <p id="acctWhy">Optional. Signing in saves your settings, rides, pins and trips to your account so they're on every device. Everything else works the same without it.</p>
  <label for="acctEmail">Email</label>
  <input type="email" id="acctEmail" placeholder="you@example.com" autocomplete="email" required>
  <label for="acctPass">Password</label>
  <input type="password" id="acctPass" autocomplete="current-password" minlength="6">
  <p class="acct-msg" id="acctMsg" role="status"></p>
  <div class="acct-row"><button type="button" data-close>Not now</button><button type="submit" class="go" id="acctSend">Sign in</button></div>
  <div class="acct-alt"><button type="button" id="acctNew">New here? Create an account</button><button type="button" id="acctLink">Forgot password? Email me a code</button></div>
  <div id="acctCodeBox" class="acct-code" hidden>
    <label for="acctCode">Code from the email</label>
    <input type="text" id="acctCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="123456">
    <div class="acct-row"><button type="button" class="go" id="acctCodeGo">Sign in with the code</button></div>
  </div>
</form>
<div id="acctOut" hidden>
  <div id="acctMenu">
    <h2>Your account</h2>
    <p>Signed in as <strong id="acctWho"></strong>. Your settings, rides and trail folders are saved to your account.</p>
    <p class="acct-msg" id="acctSync" role="status"></p>
    <div class="acct-menu">
      <button type="button" id="acctGoFolders"><span aria-hidden="true">📁</span> My trails<small>To ride, Ridden, your folders, saved routes and rides</small></button>
      <button type="button" id="acctGoSettings"><span aria-hidden="true">⚙️</span> Settings<small>Name, email, password, your data</small></button>
    </div>
    <div class="acct-row acct-out-row"><button type="button" id="acctSignOutTop">Sign out</button><button type="button" class="go" data-close>Done</button></div>
  </div>
  <div id="acctSettings" hidden>
    <h2>Settings</h2>
    <p class="acct-msg" id="acctSetMsg" role="status"></p>
    <label for="acctName">Your name</label>
    <input type="text" id="acctName" autocomplete="name" maxlength="40" placeholder="What friends see, e.g. on live location">
    <div class="acct-row" style="margin-bottom:12px"><button type="button" id="acctSetName">Save name</button></div>
    <label for="acctNewEmail">Email</label>
    <input type="email" id="acctNewEmail" autocomplete="email">
    <div class="acct-row" style="margin-bottom:12px"><button type="button" id="acctSetEmail">Change email</button></div>
    <label for="acctNewPass">New password</label>
    <input type="password" id="acctNewPass" autocomplete="new-password" minlength="6" placeholder="At least 6 characters">
    <div class="acct-row" style="margin-bottom:12px"><button type="button" id="acctSetPass">Save password</button></div>
    <label>Your data</label>
    <div class="acct-row" style="margin-bottom:12px;justify-content:flex-start"><button type="button" id="acctExport">Download my data</button></div>
    <div class="acct-row"><button type="button" id="acctBack">← Back</button><button type="button" id="acctSignOut">Sign out</button></div>
    <div class="acct-alt"><a href="privacy.html">Privacy</a> <a href="terms.html">Terms</a><button type="button" id="acctDel" class="acct-del">Delete my account</button></div>
  </div>
  <div id="acctDelBox" hidden>
    <h2>Delete account?</h2>
    <p>This deletes your account and everything saved to it: settings, rides and their photos, saved routes, spots, trail reports, grades, photos and trails you added. It can't be undone.</p>
    <p>Things saved only on this phone stay until you delete the app. You can make a new account any time.</p>
    <p class="acct-msg" id="acctDelMsg" role="status"></p>
    <div class="acct-row"><button type="button" id="acctDelNo">Keep my account</button><button type="button" class="danger" id="acctDelYes">Delete everything</button></div>
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
  // The rider's name (Settings → Your name), kept on the account (user_metadata.name), so it follows them to every device.
  api.name = () => ((api.user && api.user.user_metadata && api.user.user_metadata.name) || "").trim();
  function paintButtons() {
    buttons.forEach((b) => {
      if (api.user) { b.innerHTML = `<span class="acct-dot" aria-hidden="true"></span>Account`; b.querySelector(".acct-dot").textContent = (api.name() || api.user.email || "?")[0]; b.title = api.user.email || ""; }
      else { b.textContent = "Sign in"; b.title = "Optional: save your settings and rides to an account"; }
    });
  }
  paintButtons();
  function openBox() {
    api.load();
    q("acctIn").hidden = !!api.user; q("acctOut").hidden = !api.user;
    if (api.user) showSettings(false);
    else { q("acctMsg").textContent = ""; q("acctMsg").className = "acct-msg"; q("acctCodeBox").hidden = true; q("acctCode").value = ""; }
    if (!box.open) box.showModal();
  }
  function showSettings(on) {
    q("acctMenu").hidden = on; q("acctSettings").hidden = !on; q("acctDelBox").hidden = true;
    if (!on) q("acctWho").textContent = api.name() ? `${api.name()} (${api.user.email || ""})` : api.user.email || "";
    if (on) { q("acctNewEmail").value = api.user.email || ""; q("acctName").value = api.name(); q("acctSetMsg").textContent = ""; }
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
  // Something that needs an account (alex 2026-11-04: "if you want to save a map offline you need an account").
  // Resolves true once the person is signed in (straight away if they already are, or have a saved sign-in on this
  // device, even with no signal), false if they close the box. why: what the account is for, shown in the box.
  api.require = (why) => {
    if (api.user || api.savedSession) return Promise.resolve(true);
    if (!api.enabled) return Promise.resolve(true);
    return new Promise((resolve) => {
      openBox();
      q("acctHead").textContent = "Sign in to save maps offline";
      q("acctNeed").textContent = why || "You need a free account for this.";
      q("acctNeed").hidden = false; q("acctWhy").hidden = true;
      let done = false;
      const finish = (ok) => {
        if (done) return; done = true;
        window.removeEventListener("tf:account", onIn); box.removeEventListener("close", onClose);
        q("acctHead").textContent = "Sign in"; q("acctNeed").hidden = true; q("acctWhy").hidden = false;
        resolve(ok);
      };
      const onIn = (e) => { if (e.detail) { if (box.open) box.close(); finish(true); } };
      const onClose = () => setTimeout(() => finish(!!api.user), 1500);   // a sign-in can close the box just before tf:account
      window.addEventListener("tf:account", onIn); box.addEventListener("close", onClose);
    });
  };
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
    else { codeFor(c.email); say(`Almost done: we emailed a code to ${c.email}. Type it below (or tap the link in the email).`); }
  });
  q("acctLink").addEventListener("click", async () => {
    const c = await creds(); if (!c) return;
    say("Sending…");
    const { error } = await api.client.auth.signInWithOtp({ email: c.email, options: { emailRedirectTo: redirect() } });
    if (error) say(/rate|seconds/i.test(error.message) ? "Too many emails just now. Wait a minute and try again." : error.message, true);
    else { codeFor(c.email); say(`We emailed a code to ${c.email}. Type it below. Once you're in, you can set a new password under Account → Settings.`); }
  });
  // Sign in with the code from the email (alex 2026-11-03). The iPhone app can't catch email links (they open Safari,
  // so the rider got signed in there, not in the app); a code typed into the app works everywhere. The email still has
  // the link too. Needs {{ .Token }} in the Supabase "Magic Link" and "Confirm signup" emails (supabase/email-setup.md).
  let codeEmail = "";
  function codeFor(email) { codeEmail = email; q("acctCodeBox").hidden = false; q("acctCode").value = ""; setTimeout(() => q("acctCode").focus(), 50); }
  async function useCode() {
    const token = q("acctCode").value.replace(/\D/g, ""), email = q("acctEmail").value.trim() || codeEmail;
    if (token.length < 6) { say("Type the code from the email (6 numbers or more).", true); q("acctCode").focus(); return; }
    await api.load();
    if (!api.client) { say("Sign-in isn't available right now. Try again later.", true); return; }
    q("acctCodeGo").disabled = true; say("Checking the code…");
    // "email" covers the sign-in and the new-account emails; older projects send new accounts a "signup" code.
    let { error } = await api.client.auth.verifyOtp({ email, token, type: "email" });
    if (error) ({ error } = await api.client.auth.verifyOtp({ email, token, type: "signup" }));
    q("acctCodeGo").disabled = false;
    if (error) say(/expired|invalid/i.test(error.message) ? "That code didn't work or is too old. Check the newest email, or tap \u201cEmail me a code\u201d again." : error.message, true);
    else box.close();
  }
  q("acctCodeGo").addEventListener("click", useCode);
  q("acctCode").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); useCode(); } });
  const setMsg = (text) => { q("acctSetMsg").textContent = text; };
  q("acctSetPass").addEventListener("click", async () => {
    const pw = q("acctNewPass").value;
    if (pw.length < 6) { setMsg("Passwords need at least 6 characters."); return; }
    const { error } = await api.client.auth.updateUser({ password: pw });
    q("acctNewPass").value = "";
    setMsg(error ? "Couldn't save the password: " + error.message : "Password saved. Next time, sign in with your email and password.");
  });
  q("acctSetName").addEventListener("click", async () => {
    const name = q("acctName").value.trim().slice(0, 40);
    const { data, error } = await api.client.auth.updateUser({ data: { name } });
    if (error) { setMsg("Couldn't save the name: " + error.message); return; }
    if (data && data.user) api.user = data.user;
    paintButtons();
    try { if (name && !localStorage.getItem("tf:liveName")) localStorage.setItem("tf:liveName", JSON.stringify(name)); } catch {}
    setMsg(name ? `Saved. Friends will see \u201c${name}\u201d.` : "Name removed.");
  });
  // Download my data (privacy laws, e.g. Quebec's Law 25: people can get a copy of what we keep about them). One JSON
  // file: the account, every row saved to it, links to its photos (good for 7 days), and this device's settings.
  // Strava keys and other secrets are never in it.
  q("acctExport").addEventListener("click", async () => {
    const b = q("acctExport"), uid = api.user && api.user.id, c = api.client;
    if (!uid) return;
    b.disabled = true; setMsg("Gathering your data…");
    try {
      const out = { made_by: "Trail Finder", made_at: new Date().toISOString(),
        account: { email: api.user.email, name: api.name() || null, created_at: api.user.created_at, last_sign_in_at: api.user.last_sign_in_at } };
      const tables = { settings: "settings", rides: "rides", saved_spots_and_pins: "ski_points", trail_reports: "trail_reports", trail_grades: "trail_grades",
        trail_photos: "trail_photos", trails_you_added: "rider_trails", trail_votes: "rider_trail_votes", reports_of_bad_content: "content_flags" };
      for (const [name, table] of Object.entries(tables)) {
        const { data, error } = await c.from(table).select("*").eq("user_id", uid).limit(5000).then((r) => r, (e) => ({ error: e }));
        if (!error && data && data.length) out[name] = data;
      }
      const photos = [];
      for (const bucket of ["ride-photos", "point-photos"]) {
        const files = await listFiles(bucket, uid).catch(() => []);
        for (let i = 0; i < files.length; i += 100) {
          const { data } = await c.storage.from(bucket).createSignedUrls(files.slice(i, i + 100), 7 * 86400).then((r) => r, () => ({ data: null }));
          (data || []).forEach((f) => { if (f.signedUrl) photos.push({ file: `${bucket}/${f.path}`, link: f.signedUrl }); });
        }
      }
      (out.trail_photos || []).forEach((p) => { if (p.path) photos.push({ file: `trail-photos/${p.path}`, link: c.storage.from("trail-photos").getPublicUrl(p.path).data.publicUrl }); });
      if (photos.length) out.photos = photos;
      const device = {};
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^tf:/.test(k) && k !== "tf:shareKey") device[k.slice(3)] = localStorage.getItem(k); } } catch {}
      out.this_device = device;
      const text = JSON.stringify(out, null, 1), fname = `trail-finder-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      const file = typeof File === "function" ? new File([text], fname, { type: "application/json" }) : null;
      // Phones (and the iPhone app) save through the share sheet ("Save to Files"); computers download the file.
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        await navigator.share({ files: [file], title: "My Trail Finder data" }).catch((e) => { if (e && e.name !== "AbortError") throw e; });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = fname;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      setMsg(`Your data is ready (${Math.max(1, Math.round(text.length / 1024))} KB). Photo links in it work for 7 days.`);
    } catch (e) { setMsg("Couldn't gather your data: " + ((e && e.message) || e) + ". Try again in a minute."); }
    b.disabled = false;
  });
  q("acctSetEmail").addEventListener("click", async () => {
    const email = q("acctNewEmail").value.trim();
    if (!q("acctNewEmail").reportValidity() || !email || email === api.user.email) return;
    const { error } = await api.client.auth.updateUser({ email }, { emailRedirectTo: redirect() });
    setMsg(error ? "Couldn't change the email: " + error.message : `Check ${email} (and your old address) and tap the confirm links. The change happens after that.`);
  });
  // Sign out sits right in the Your account box (alex 2026-11-03) and again under Settings.
  // Signing out also takes the rider's own things off this device (alex 2026-11-03: signed out on the computer, Ridden,
  // Saved and folders were still there). They stay in the account and come back on the next sign-in. Map look (style,
  // sport, area, colours) stays, it isn't personal. Rides and pins that never went to the account (a Strava archive
  // kept on this device, or saved here before signing in) stay too: removing them would lose them for good.
  const PREFS = new Set(["months", "colorBy", "allTrails", "prime", "zone", "basemap4", "nearKm", "track", "nameNear", "mode", "nameZone", "toride", "riddenMap", "newsSeen"]);
  // Personal things kept only on the device (not in SETTINGS): Strava link, pending reports/grades, alerts already
  // seen, the home spot, the friends' live groups looked at, route drafts, the friend/admin flags, notifications.
  const DEVICE_PERSONAL = ["strava", "stravaFolder", "stravaPending", "stravaReady", "stravaAsked", "liveGroups", "liveName", "caHome",
    "repQueue", "gradeQueue", "hiddenRiders", "loamAlerts", "fishAlerts", "avyAlerts", "findsScan", "findsCache", "myFindsNo", "plan", "planPicks",
    "loopWant", "loopSkip", "shareSent", "shareYes", "shareNo", "rideShapes", "riderTrailDraft", "whereRecent", "tripMe", "skiPlan", "motoPlan",
    "hikeGrades", "usageWho", "pushId", "pushSaved", "pushErr", "settingsAt", "settingsKeyAt"];
  api.personalKeys = () => [...SETTINGS.filter((k) => !PREFS.has(k)), ...DEVICE_PERSONAL].map((k) => "tf:" + k).concat(["tf-friend", "tf-admin"]);
  // Removes the records of an account from one of the app's IndexedDB stores (owner = account id). Never creates the
  // database: a device that never had it stays without it.
  const dropOwned = (dbName, store, also) => new Promise((resolve) => {
    let r;
    try { r = indexedDB.open(dbName); } catch { resolve(0); return; }
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch {} };
    r.onerror = () => resolve(0);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(store)) { db.close(); resolve(0); return; }
      const stores = [store].concat(also && db.objectStoreNames.contains(also.store) ? [also.store] : []);
      const tx = db.transaction(stores, "readwrite"), os = tx.objectStore(store);
      let n = 0;
      os.openCursor().onsuccess = (e) => {
        const c = e.target.result;
        if (!c) return;
        if (c.value && c.value.owner) {
          n++;
          if (stores.length > 1) {
            const idx = tx.objectStore(also.store).index(also.index);
            idx.openKeyCursor(IDBKeyRange.only(c.value.id)).onsuccess = (ev) => { const k = ev.target.result; if (k) { tx.objectStore(also.store).delete(k.primaryKey); k.continue(); } };
          }
          c.delete();
        }
        c.continue();
      };
      tx.oncomplete = () => { db.close(); resolve(n); };
      tx.onerror = tx.onabort = () => { db.close(); resolve(n); };
    };
  });
  api.clearDevice = async () => {
    // Phone notifications follow the person: stop them for this device (they watched that rider's trails).
    const pushId = lsGet("tf:pushId");
    if (pushId && api.client) await api.client.rpc("push_delete", { p_id: pushId }).then(() => {}, () => {});
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      const sub = reg && reg.pushManager && await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch {}
    api.personalKeys().forEach((k) => lsSet(k, null));
    const rides = await dropOwned("trail-finder-rides", "rides", { store: "photos", index: "rideId" });
    const pins = await dropOwned("trail-finder-points", "points");
    return { rides, pins };
  };
  async function signOut() {
    const note = q("acctSync"), btns = [q("acctSignOut"), q("acctSignOutTop")];
    btns.forEach((b) => { b.disabled = true; });
    note.textContent = "Saving your last changes to your account…";
    // Anything changed here that isn't in the account yet goes up first, so taking it off this device loses nothing.
    const saved = await api.sync().catch(() => false);
    if (saved === false && !confirm("Your account didn't answer (no signal?). Changes made on this device since the last save will be lost if you sign out now.\n\nSign out anyway?")) {
      note.textContent = "Not signed out. Try again when you have signal.";
      btns.forEach((b) => { b.disabled = false; });
      return;
    }
    window.dispatchEvent(new CustomEvent("tf:signing-out", { detail: api.user }));
    // Off the device first, then sign out: friends.js reloads the page when the friend flag changes on sign-out, and
    // that reload must not cut the clean-up short. No sync runs in between (api.signingOut), so the emptied lists
    // never go up to the account.
    api.signingOut = true;
    await api.clearDevice();
    try { await api.client.auth.signOut(); } catch { await api.client.auth.signOut({ scope: "local" }).catch(() => {}); }
    try { sessionStorage.setItem("tf:signedOut", "1"); } catch {}
    // A fresh start, so nothing of the account is left in the open page either.
    location.reload();
  }
  // Right after a sign-out: say what happened, once.
  try {
    if (sessionStorage.getItem("tf:signedOut")) {
      sessionStorage.removeItem("tf:signedOut");
      setTimeout(() => {
        const t = document.createElement("div");
        t.className = "acct-toast"; t.setAttribute("role", "status");
        t.textContent = "Signed out. Your saved trails, folders, rides and pins were taken off this device. They're safe in your account.";
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 6000);
      }, 600);
    }
  } catch {}
  q("acctSignOut").addEventListener("click", signOut);
  q("acctSignOutTop").addEventListener("click", signOut);

  // Delete my account (Apple rule 5.1.1): the rider's own photo files go first through Storage (folders named by the
  // user id), then delete_my_account() (supabase/delete-account.sql) removes the sign-in and every row tied to it.
  // Anonymous ride sharing has no account link, so its rides are taken back with the rider's share key.
  q("acctDel").addEventListener("click", () => {
    q("acctSettings").hidden = true; q("acctDelBox").hidden = false;
    q("acctDelMsg").textContent = ""; q("acctDelMsg").className = "acct-msg"; q("acctDelYes").disabled = false;
  });
  q("acctDelNo").addEventListener("click", () => showSettings(true));
  async function listFiles(bucket, dir, depth = 0) {
    const { data, error } = await api.client.storage.from(bucket).list(dir, { limit: 1000 });
    if (error || !data) return [];
    const out = [];
    for (const f of data) {
      if (f.id) out.push(`${dir}/${f.name}`);
      else if (depth < 2) out.push(...await listFiles(bucket, `${dir}/${f.name}`, depth + 1));   // a folder (rides: <user>/<ride>/)
    }
    return out;
  }
  async function removeMyFiles(uid) {
    const c = api.client;
    for (const bucket of ["ride-photos", "point-photos"]) {
      const files = await listFiles(bucket, uid).catch(() => []);
      for (let i = 0; i < files.length; i += 100) await c.storage.from(bucket).remove(files.slice(i, i + 100)).catch(() => {});
    }
    // Trail photos are a public bucket with no list rule: their paths are in the table.
    const { data } = await c.from("trail_photos").select("path").eq("user_id", uid).then((r) => r, () => ({ data: null }));
    const paths = (data || []).map((r) => r.path).filter(Boolean);
    if (paths.length) await c.storage.from("trail-photos").remove(paths).catch(() => {});
  }
  q("acctDelYes").addEventListener("click", async () => {
    const msg = q("acctDelMsg"), yes = q("acctDelYes");
    yes.disabled = true; msg.className = "acct-msg"; msg.textContent = "Deleting…";
    try {
      const uid = api.user && api.user.id;
      if (!uid) throw new Error("Not signed in");
      await removeMyFiles(uid);
      const key = jparse(lsGet("tf:shareKey"), null);   // share.js keeps it as JSON
      if (key) await api.client.rpc("unshare_all", { p_key: key }).then(() => {}, () => {});
      const { error } = await api.client.rpc("delete_my_account");
      if (error) throw error;
      ["tf:shareKey", "tf:shareOn", STAMP, KEYAT].forEach((k) => lsSet(k, null));
      window.dispatchEvent(new CustomEvent("tf:signing-out", { detail: api.user }));
      api.signingOut = true;
      await api.clearDevice();
      await api.client.auth.signOut({ scope: "local" }).catch(() => {});
      api.signingOut = false;
      setUser(null);
      msg.textContent = "Your account is deleted.";
      setTimeout(() => box.close(), 1800);
    } catch (e) {
      yes.disabled = false; msg.className = "acct-msg err";
      msg.textContent = "Couldn't delete the account: " + ((e && e.message) || e) + ". Try again, or write to us from the Support page.";
    }
  });

  // ---------- settings ----------
  // Each device stamps every setting it changes (tf:settingsKeyAt), and a sync merges key by key: the newer change
  // wins, so changing the map style on the phone no longer wipes a route just saved on the computer. Saved routes
  // merge both devices' lists (deleted ones are remembered in tf:planGone). Syncs run on sign-in, after a change,
  // when the app comes back to the screen, and when a page asks (tfAccount.sync(), e.g. opening 📂 Saved).
  const KEYAT = "tf:settingsKeyAt";
  const LIVE = new Set(["planSaved", "planGone", "notifyRead", "loamAlert", "myFinds", "shareOn", "shareKey", "sharePast", "shareFrom", "sharePlaces", "newsSeen",
    "listGone", "skiTrips", "skiTours", "skiWatch", "avyAlert", "fishAlert", "huntAlarms", "motoRoutes", "motoBikes", "motoBike", "hikeSaved", "hikePlans"]);   // read fresh by the page, so no reload
  const jparse = (v, d) => { try { const x = JSON.parse(v); return x == null ? d : x; } catch { return d; } };
  // A saved list both devices add to: items by id, the newer edit wins, minus those deleted (tf:listGone) after their
  // last edit. sorted: newest first (else this device's order, then the account's new ones). max: the page's own cap.
  const listMerge = (key, idOf, whenOf, sorted, max) => (a, b, out) => {
    const gone = {};
    jparse(out.listGone, []).forEach((g) => { if (g && g.k === key && !(gone[g.id] >= g.at)) gone[g.id] = g.at || 0; });
    const all = new Map();
    [...jparse(a, []), ...jparse(b, [])].forEach((e) => {
      const id = e && idOf(e);
      if (id == null || (gone[id] != null && gone[id] >= whenOf(e))) return;
      const was = all.get(String(id));
      if (!was || whenOf(e) > whenOf(was)) all.set(String(id), e);
    });
    let list = [...all.values()];
    if (sorted) list.sort((x, y) => whenOf(y) - whenOf(x) || (String(idOf(x)) < String(idOf(y)) ? -1 : 1));
    list = list.slice(0, max);
    return list.length ? JSON.stringify(list) : null;
  };
  const MERGE = {
    listGone: (a, b) => {
      const all = {};
      [...jparse(a, []), ...jparse(b, [])].forEach((g) => { const id = g && g.k && g.id != null && g.k + "\n" + g.id; if (id && !(all[id] && all[id].at >= g.at)) all[id] = g; });
      const list = Object.values(all).sort((x, y) => y.at - x.at || (x.k + x.id < y.k + y.id ? -1 : 1)).slice(0, 300);
      return list.length ? JSON.stringify(list) : null;
    },
    skiTrips: listMerge("skiTrips", (t) => t.id, (t) => t.ed || t.at || 0, true, 20),         // cabin trips (cabin-trip.js)
    skiTours: listMerge("skiTours", (t) => t.id, (t) => t.ed || t.at || 0, true, 50),         // Skiing: planned tours saved (winter.js)
    skiWatch: listMerge("skiWatch", (w) => w.k, (w) => w.at || 0, true, 40),                 // 🔔 Watch this tour (winter.js)
    motoRoutes: listMerge("motoRoutes", (r) => r.id, (r) => r.ed || r.at || 0, true, 40),   // Adventure moto saved routes
    motoBikes: listMerge("motoBikes", (k) => k.id, (k) => k.ed || 0, false, 20),            // Adventure moto: my bikes
    hikeSaved: listMerge("hikeSaved", (h) => h.id, (h) => h.at || 0, true, 200),            // Hiking: saved hikes (hike.js)
    hikePlans: listMerge("hikePlans", (h) => h.id, (h) => h.at || 0, true, 100),            // Hiking: planned hikes (hike.js)
    // What's new (whats-new.js): the newest change seen on any device, so a line read on the phone isn't shown again on the computer.
    newsSeen: (a, b) => {
      const x = jparse(a, null), y = jparse(b, null);
      if (!x || !y) return a || b || null;
      return x.date > y.date || (x.date === y.date && x.n >= y.n) ? a : b;
    },
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
    nudgeCheck(snap, cur);
    snap = cur;
    lsSet(KEYAT, JSON.stringify(at)); lsSet(STAMP, String(now));
    if (!api.user) return;
    clearTimeout(pushTimer); pushTimer = setTimeout(api.sync, 1500);
  });
  // ---------- a gentle "Sign in" nudge (alex 2026-11-04: encourage accounts, never require one) ----------
  // When someone who isn't signed in saves something (a route, tour, cabin trip, hike, trail on a list) or turns an
  // alert on, a small card says it's only on this phone and offers Sign in. "Not now" keeps it quiet for 3 weeks, and
  // after 3 "Not now"s it never shows again. At most once a day. Kept in tf:signNudge (this device only, not synced).
  const arr = (v) => { const x = jparse(v, null); return Array.isArray(x) ? x : []; };
  const on = (v) => { const x = jparse(v, null); return x && x !== "0" ? 1 : 0; };
  const NUDGE = {   // what each saved list counts, and what the card calls it
    planSaved: [(v) => arr(v).length, "this route"],
    motoRoutes: [(v) => arr(v).length, "this route"],
    skiTrips: [(v) => arr(v).length, "this cabin trip"],
    skiTours: [(v) => arr(v).length, "this tour"],
    hikeSaved: [(v) => arr(v).length, "this hike"],
    hikePlans: [(v) => arr(v).length, "this hike"],
    folders: [(v) => arr(v).reduce((n, f) => n + ((f && f.trails && f.trails.length) || 0), 0), "your trail lists"],
    myFinds: [(v) => arr(v).length, "your finds"],
    skiWatch: [(v) => arr(v).length, "your alerts"],
    notifyNew: [on, "your alerts"],
    avyAlert: [on, "your alerts"],
    fishAlert: [on, "your alerts"],
    huntAlarms: [(v) => { const x = jparse(v, null); return x && x.on ? Object.values(x.on).filter(Boolean).length : 0; }, "your alerts"],
  };
  const NUDGE_KEY = "tf:signNudge", DAY = 864e5;
  function nudgeCheck(prev, cur) {
    if (api.user || api.savedSession) return;
    let what = "";
    for (const k in NUDGE) {
      if (cur[k] === prev[k]) continue;
      const [count, name] = NUDGE[k];
      try { if (count(cur[k]) > count(prev[k])) { what = name; break; } } catch {}
    }
    if (!what) return;
    const st = jparse(lsGet(NUDGE_KEY), null) || {}, now = Date.now();
    if ((st.no || 0) >= 3 || now < (st.quiet || 0) || now - (st.shown || 0) < DAY) return;
    st.shown = now; lsSet(NUDGE_KEY, JSON.stringify(st));
    setTimeout(() => showNudge(what), 2200);   // after the page's own "Saved" toast
  }
  function showNudge(what) {
    if (api.user || document.querySelector(".acct-nudge")) return;
    const el = document.createElement("div");
    el.className = "acct-nudge"; el.setAttribute("role", "status");
    const isAlert = what === "your alerts";
    el.innerHTML = `<p><strong></strong><span></span></p><div class="acct-row"><button type="button" data-n="no">Not now</button><button type="button" class="go" data-n="in">Sign in</button></div>`;
    el.querySelector("strong").textContent = isAlert ? "Keep your alerts" : "Saved on this phone only";
    el.querySelector("span").textContent = isAlert
      ? "Sign in so your alerts follow you to a new phone. Free, and the app works the same without it."
      : `Sign in to have ${what} on all your devices, and keep it if you lose your phone. Free, and the app works the same without it.`;   // whole sentences in scripts/i18n/fr-8.txt
    const close = () => { el.classList.remove("on"); setTimeout(() => el.remove(), 250); };
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-n]"); if (!b) return;
      if (b.dataset.n === "no") {
        const st = jparse(lsGet(NUDGE_KEY), null) || {};
        st.no = (st.no || 0) + 1; st.quiet = Date.now() + 21 * DAY; lsSet(NUDGE_KEY, JSON.stringify(st));
      } else openBox();
      close();
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("on"));
    setTimeout(() => { if (el.isConnected) close(); }, 20000);   // ignored: gone, and back at the next save tomorrow
  }
  window.addEventListener("tf:account", (e) => { if (e.detail) document.querySelectorAll(".acct-nudge").forEach((n) => n.remove()); });

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
    if (!api.user || !api.client || api.signingOut) return false;
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
