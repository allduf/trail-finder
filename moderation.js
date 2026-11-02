// Report and hide what riders post (go-public checklist item 3, Apple App Review rule 1.2, alex 2026-11-02).
// Trail reports (reports.js), rider photos (trail-photos.js) and rider grades (grades.js) show ⚑ Report, and posts by
// other riders show "Hide this rider". A report needs the sign-in (supabase/moderation.sql, table content_flags);
// 3 reports hide a post for everyone, and alex keeps or removes it on usage.html. Hiding a rider stays on this phone
// (tf:hiddenRiders) and works without an account. After either, "tf:modchange" tells the lists to redraw.
// Rider-added trails keep their own ⚑ Report (rider-trails.js).
(() => {
  "use strict";
  const acct = window.tfAccount;
  const KEY = "tf:hiddenRiders";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch { return []; } };
  const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v.slice(-500))); } catch {} };
  const changed = () => document.dispatchEvent(new CustomEvent("tf:modchange"));
  const REASONS = [["rude", "Rude, hateful or harassing"], ["spam", "Spam or ads"], ["wrong", "Wrong or not about this trail"],
    ["unsafe", "Dangerous or illegal"], ["private", "Shows a person or private info"], ["other", "Something else"]];

  const css = document.createElement("style");
  css.textContent = `
.mod-btns { display: inline-flex; flex-wrap: wrap; gap: 4px 10px; }
.mod-btns button { font: inherit; font-size: .8rem; background: none; border: 0; padding: 6px 0; min-height: 32px; color: var(--muted); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.mod-hidden { font-size: .85rem; color: var(--muted); margin: 0 0 8px; }
.mod-hidden button { font: inherit; background: none; border: 0; padding: 4px 0; color: var(--accent); cursor: pointer; text-decoration: underline; }
dialog.mod-dlg { border: 0; border-radius: 18px; background: var(--panel); color: var(--fg); padding: 16px 16px 12px; width: min(400px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); box-sizing: border-box; box-shadow: 0 14px 50px rgba(0,0,0,.4); font: inherit; overflow: auto; }
dialog.mod-dlg::backdrop { background: rgba(6,16,10,.55); }
dialog.mod-dlg h2 { margin: 0 0 8px; font-size: 1.2rem; }
dialog.mod-dlg .mod-reasons { display: flex; flex-direction: column; gap: 4px; margin: 0 0 8px; }
dialog.mod-dlg label { display: flex; align-items: center; gap: 10px; min-height: 40px; font-size: .95rem; cursor: pointer; }
dialog.mod-dlg input[type=radio], dialog.mod-dlg input[type=checkbox] { width: 20px; height: 20px; margin: 0; accent-color: var(--accent); flex: none; }
dialog.mod-dlg textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); min-height: 60px; }
dialog.mod-dlg .mod-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 10px; }
dialog.mod-dlg .mod-row button { font: inherit; font-weight: 700; min-height: 44px; padding: 8px 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
dialog.mod-dlg .mod-row .go { background: var(--cta); color: var(--cta-fg); border-color: transparent; }
dialog.mod-dlg .mod-msg { font-size: .88rem; color: var(--muted); margin: 6px 0 0; }
dialog.mod-dlg .mod-small { font-size: .82rem; color: var(--muted); margin: 8px 0 0; }`;
  document.head.append(css);

  let dlg = null;
  function signedIn() { return !!(acct && acct.user); }
  function openSignIn() { if (acct && acct.open) acct.open(); else { const b = document.querySelector(".acct-btn"); if (b) b.click(); } }
  async function send(k, t, ot, reason, note) {
    if (!acct || !acct.enabled) return "Reports aren't available here.";
    await acct.load();
    if (!acct.client || !acct.user) return "Sign in first.";
    const { error } = await acct.client.from("content_flags").insert({ kind: k, target_id: t, osm_type: ot || null, reason, note: note || null });
    if (error && !/duplicate|unique/i.test(error.message)) return /content_flags|schema cache|relation/i.test(error.message) ? "Reports aren't set up yet." : "Couldn't send it. Try again later.";
    return "";
  }
  function report(k, t, ot, uid) {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "mod-dlg";
      dlg.setAttribute("aria-label", "Report");
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
      document.body.append(dlg);
    }
    const what = k === "photo" ? "this photo" : k === "grade" ? "these rider grades" : "this trail report";
    if (!signedIn()) {
      dlg.innerHTML = `<h2>Report ${what}</h2><p>Sign in to report it, so reports can't be faked.</p>
        <p class="mod-small">Or email trailfinder.help@outlook.com.${uid ? " You can also hide this rider without an account." : ""}</p>
        <div class="mod-row">${uid ? `<button type="button" data-hide>Hide this rider</button>` : ""}<button type="button" data-x>Cancel</button><button type="button" class="go" data-in>Sign in</button></div>`;
    } else {
      dlg.innerHTML = `<h2>Report ${what}</h2>
        <form method="dialog"><div class="mod-reasons" role="radiogroup" aria-label="Why?">${REASONS.map(([v, n], i) => `<label><input type="radio" name="why" value="${v}"${i ? "" : " checked"}> <span>${esc(n)}</span></label>`).join("")}</div>
        <textarea maxlength="280" placeholder="Anything else? (optional)"></textarea>
        ${uid ? `<label><input type="checkbox" data-also checked> <span>Also hide everything from this rider</span></label>` : ""}
        <p class="mod-small">Posts several riders report are hidden until they're checked. You can also email trailfinder.help@outlook.com.</p>
        <p class="mod-msg" role="status"></p>
        <div class="mod-row"><button type="button" data-x>Cancel</button><button type="submit" class="go">Send report</button></div></form>`;
      dlg.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const go = dlg.querySelector(".go"), msg = dlg.querySelector(".mod-msg");
        go.disabled = true; msg.textContent = "Sending…";
        const err = await send(k, t, ot, dlg.querySelector("input[name=why]:checked").value, dlg.querySelector("textarea").value.trim().slice(0, 280));
        if (err) { msg.textContent = err; go.disabled = false; return; }
        const also = dlg.querySelector("[data-also]");
        if (also && also.checked) hide(uid, true);
        dlg.innerHTML = `<h2>Thanks, your report is in</h2><p>It will be checked. Posts several riders report stop showing.</p><div class="mod-row"><button type="button" class="go" data-x>Close</button></div>`;
        wire(uid);
        changed();
      });
    }
    wire(uid);
    if (!dlg.open) dlg.showModal();
  }
  function wire(uid) {
    dlg.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => dlg.close()));
    const i = dlg.querySelector("[data-in]"); if (i) i.addEventListener("click", () => { dlg.close(); openSignIn(); });
    const h = dlg.querySelector("[data-hide]"); if (h) h.addEventListener("click", () => { dlg.close(); hide(uid); });
  }
  function hide(uid, quiet) {
    if (!uid) return;
    const v = load(); if (!v.includes(uid)) { v.push(uid); save(v); }
    if (!quiet) changed();
  }
  document.addEventListener("click", (e) => {
    const r = e.target.closest("[data-mod-report]");
    if (r) { e.preventDefault(); report(r.dataset.k, +r.dataset.t, r.dataset.ot || "", r.dataset.u || ""); return; }
    const h = e.target.closest("[data-mod-hide]");
    if (h) { e.preventDefault(); if (confirm("Hide everything this rider posts? You can show them again from any trail.")) hide(h.dataset.u); return; }
    if (e.target.closest("[data-mod-unhide]")) { e.preventDefault(); save([]); changed(); }
  });

  window.tfMod = {
    hidden: (uid) => !!uid && load().includes(uid),
    // The ⚑ Report and Hide this rider buttons for one post (none on the rider's own posts).
    buttons(k, t, uid, ot) {
      const me = acct && acct.user ? acct.user.id : null;
      if (uid && uid === me) return "";
      return `<span class="mod-btns"><button type="button" data-mod-report data-k="${esc(k)}" data-t="${esc(t)}"${ot ? ` data-ot="${esc(ot)}"` : ""}${uid ? ` data-u="${esc(uid)}"` : ""}>⚑ Report</button>${uid ? `<button type="button" data-mod-hide data-u="${esc(uid)}">Hide this rider</button>` : ""}</span>`;
    },
    // Drop posts from hidden riders; n says how many were left out (for a "Show them" line).
    filter(rows) { const v = load(); const out = rows.filter((r) => !v.includes(r.user_id)); return { rows: out, n: rows.length - out.length }; },
    hiddenLine: (n) => (n ? `<p class="mod-hidden">${n === 1 ? "1 post" : `${n} posts`} from riders you hid. <button type="button" data-mod-unhide>Show hidden riders again</button></p>` : ""),
  };
})();
