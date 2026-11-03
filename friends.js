// Friends see unofficial trails (go-public checklist item 8, alex 2026-11-03).
// The app reads localStorage "tf-friend" when it opens (index.html, the tf-pub class in <head> and FRIEND in the main
// script): "1" = alex or a friend alex added on usage.html (supabase/friends.sql), so the Unofficial chips, Likely MTB
// paths and possible unmapped lines show, as before. Anyone else gets the public map: hidden or risky trails left out.
// After each sign-in or sign-out this asks Supabase (tf_is_friend) and reloads the page once when the answer changed.
// The key has no "tf:" prefix, so account.js never syncs it between devices: each device asks for itself.
(function () {
  const KEY = "tf-friend";
  const now = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
  const save = (v) => { try { if (v) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch {} };
  const flip = (v) => { if (v === now()) return; save(v); location.reload(); };
  // alex (tf_is_admin) gets More → Friends on this device: "tf-admin" = "1", asked after each sign-in.
  const ADMIN = "tf-admin";
  const isAdmin = () => { try { return localStorage.getItem(ADMIN) === "1"; } catch { return false; } };
  const saveAdmin = (v) => { try { if (v) localStorage.setItem(ADMIN, "1"); else localStorage.removeItem(ADMIN); } catch {} };
  async function check(user) {
    const a = window.tfAccount;
    if (!a) return;
    if (!user) { saveAdmin(false); flip(false); return; }
    if (!a.client) return;
    try { const { data, error } = await a.client.rpc("tf_is_admin"); if (!error) saveAdmin(data === true); } catch {}
    try {
      const { data, error } = await a.client.rpc("tf_is_friend");
      if (error) return;   // no signal, or friends.sql not run yet: keep what this device knew
      flip(data === true);
    } catch {}
  }

  // ---------- More → Friends (alex only): add or remove who sees unofficial trails, right in the app ----------
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = document.createElement("style");
  css.textContent = `
dialog.frd { border: 0; border-radius: 20px; background: var(--panel); color: var(--fg); padding: 18px 16px 14px; width: min(420px, calc(100vw - 24px)); max-height: calc(100dvh - 48px); box-sizing: border-box; box-shadow: 0 14px 50px rgba(0,0,0,.4); font: inherit; overflow: auto; }
dialog.frd::backdrop { background: rgba(0,0,0,.45); }
dialog.frd h2 { margin: 0 0 4px; font-size: 1.2rem; }
dialog.frd .frd-lead { margin: 0 0 12px; color: var(--muted); font-size: .92rem; line-height: 1.35; }
dialog.frd form { display: flex; gap: 8px; margin-bottom: 12px; }
dialog.frd input { flex: 1; min-width: 0; font: inherit; font-size: 16px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); color: var(--fg); }
dialog.frd button { font: inherit; min-height: 44px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); cursor: pointer; }
dialog.frd button.frd-add { background: var(--accent, #2f9e44); color: #fff; border-color: transparent; font-weight: 600; }
dialog.frd ul { list-style: none; margin: 0 0 12px; padding: 0; }
dialog.frd li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }
dialog.frd li .frd-who { flex: 1; min-width: 0; overflow-wrap: anywhere; }
dialog.frd li small { display: block; color: var(--muted); }
dialog.frd .frd-msg { min-height: 1.2em; margin: 0 0 8px; color: var(--muted); font-size: .9rem; }
dialog.frd .frd-msg.err { color: #c92a2a; }
dialog.frd .frd-close { width: 100%; }`;
  document.head.append(css);
  let dlg = null;
  async function paint(msg, err) {
    const a = window.tfAccount, list = dlg.querySelector("ul"), m = dlg.querySelector(".frd-msg");
    if (!a || !a.client || !a.user) { list.innerHTML = ""; m.textContent = "Sign in first (More, Account)."; m.className = "frd-msg err"; return; }
    const { data, error } = await a.client.rpc("tf_friend_list");
    if (error) {
      list.innerHTML = "";
      m.textContent = /Could not find|does not exist/.test(error.message) ? "One step left: run supabase/friends.sql in Supabase." : /not allowed/.test(error.message) ? "Only alex can change the friends list." : "No connection. Try again in a moment.";
      m.className = "frd-msg err"; return;
    }
    m.textContent = msg || ""; m.className = "frd-msg" + (err ? " err" : "");
    list.innerHTML = data.length ? data.map((f) => `<li><span class="frd-who">${esc(f.email)}${f.signed_up ? "" : "<small>No account with this email yet: they create one in the app</small>"}</span>
      <button type="button" data-rm="${esc(f.email)}">Remove</button></li>`).join("") : `<li><span class="frd-who"><small>No friends added yet.</small></span></li>`;
  }
  async function set(email, add) {
    const a = window.tfAccount;
    const { error } = await a.client.rpc("tf_friend_set", { e: email, add });
    if (error) { paint("Couldn't save: " + (/not allowed/.test(error.message) ? "only alex can change the list." : "no connection, try again."), true); return false; }
    paint(add ? `${email} added. They sign in once with this email.` : `${email} removed.`);
    return true;
  }
  async function open() {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "frd";
      dlg.setAttribute("aria-label", "Friends");
      dlg.innerHTML = `<h2>Friends</h2>
        <p class="frd-lead">They see unofficial trails like you do. Everyone else never sees your unofficial list, closed or no-bikes trails, Likely MTB paths or possible unmapped lines.</p>
        <form><input type="email" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="friend@email.com" aria-label="Friend's email"><button type="submit" class="frd-add">Add</button></form>
        <p class="frd-msg" role="status"></p><ul></ul>
        <button type="button" class="frd-close">Done</button>`;
      dlg.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const inp = dlg.querySelector("input"), email = inp.value.trim().toLowerCase();
        if (!email) return;
        e.submitter && (e.submitter.disabled = true);
        if (await set(email, true)) inp.value = "";
        e.submitter && (e.submitter.disabled = false);
      });
      dlg.addEventListener("click", async (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.classList.contains("frd-close")) dlg.close();
        else if (b.dataset.rm && confirm(`${b.dataset.rm} will stop seeing unofficial trails.`)) { b.disabled = true; await set(b.dataset.rm, false); }
      });
      document.body.append(dlg);
    }
    dlg.showModal();
    const m = dlg.querySelector(".frd-msg"); m.textContent = "Loading…"; m.className = "frd-msg";
    paint();
    const a = window.tfAccount;
    if (a && !a.client && a.load) { await a.load(); paint(); }
  }
  window.tfFriends = { admin: isAdmin, open };
  window.addEventListener("tf:account", (e) => check(e.detail));
  // Signed in from before: tf:account fires once the sign-in library loads. Never signed in here: no event, so a device
  // that was a friend's and has no sign-in any more goes back to the public map.
  const a = window.tfAccount;
  if (a && a.ready) a.ready.then((u) => { if (!u && now()) flip(false); });
})();
