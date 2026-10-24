// What's new (alex, 2026-10-24: "every time a user opens the app show a list of what changed since they last
// connected... simple and quick to read"). When the app opens or comes back to the front, a small card lists the
// changes since this rider last saw it: one short line each, one tap anywhere closes it, nothing shows when nothing changed.
//  - The lines are data/changelog.json (hand-edited, newest first: { date: "YYYY-MM-DD", text }). Add a line at the top
//    for each change people will notice.
//  - tf:newsSeen = { date, n }: the newest date seen and how many lines with that date were there. Synced with the
//    account (account.js SETTINGS), so a line read on the phone isn't shown again on the computer.
//  - A brand-new device sees nothing the first time (everything counts as seen); a device that already used the app
//    before this card existed sees the latest lines once.
//  - At most 6 lines on open; More › What's new opens the list again (window.tfWhatsNew.open()).
(() => {
  "use strict";
  const KEY = "tf:newsSeen", MAX = 6, WAIT_MS = 2500, AGAIN_MS = 3600e3;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const getSeen = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const putSeen = (v) => {
    try { const s = JSON.stringify(v); if (localStorage.getItem(KEY) === s) return; localStorage.setItem(KEY, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
  };
  // Has this device used the app before? Read now, before the app saves its first settings: notify.js's visit record
  // has the previous visit, or (when the bell isn't there) any tf: setting was saved before.
  const usedBefore = (() => {
    try {
      const v = JSON.parse(localStorage.getItem("tf:notifyVisit"));
      if (v) return !!v.prev;
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("tf:") && k !== KEY) return true; }
    } catch {}
    return false;
  })();
  const dayLabel = (d) => {
    const t = new Date(d + "T12:00"), days = Math.round((new Date().setHours(12, 0, 0, 0) - t) / 864e5);
    return days <= 0 ? "Today" : days === 1 ? "Yesterday" : t.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const css = document.createElement("style");
  css.textContent = `
dialog.wnew { border: 1px solid var(--line); border-radius: 16px; background: var(--panel); color: var(--fg); padding: 16px 16px 12px; width: min(420px, calc(100vw - 32px)); max-height: min(70dvh, 560px); overflow: auto; box-sizing: border-box; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.wnew::backdrop { background: rgba(0,0,0,.4); }
dialog.wnew h2 { margin: 0 0 4px; font-family: var(--font-display); font-size: 1.25rem; }
dialog.wnew h3 { margin: 12px 0 4px; font-size: .74rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
dialog.wnew ul { list-style: none; margin: 0; padding: 0; }
dialog.wnew li { padding: 6px 0 6px 18px; position: relative; font-size: .95rem; line-height: 1.3; border-top: 1px solid var(--line); }
dialog.wnew h3 + ul li:first-child { border-top: 0; }
dialog.wnew li::before { content: ""; position: absolute; left: 3px; top: 12px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
dialog.wnew .wn-more { color: var(--muted); font-size: .85rem; margin: 8px 0 0; }
dialog.wnew button.wn-ok { display: block; width: 100%; margin-top: 12px; font: inherit; font-weight: 700; padding: 11px; border-radius: 12px; border: 0; background: var(--cta); color: var(--cta-fg); cursor: pointer; }`;
  document.head.append(css);

  let items = null, dlg = null;
  const load = () => fetch("data/changelog.json", { cache: "no-cache" }).then((r) => r.json())
    .then((d) => (items = (d.items || []).filter((x) => x && /^\d{4}-\d\d-\d\d$/.test(x.date) && x.text))).catch(() => items || []);
  // the lines newer than what this device (or the account) has seen
  function unseen(list, seen) {
    if (!seen) return list;
    const same = list.filter((x) => x.date === seen.date).length;
    let sameNew = Math.max(0, same - (seen.n || 0));
    return list.filter((x) => x.date > seen.date || (x.date === seen.date && sameNew-- > 0));
  }
  const markSeen = (list) => { if (list.length) putSeen({ date: list[0].date, n: list.filter((x) => x.date === list[0].date).length }); };

  function show(list, title, max = MAX) {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "wnew";
      dlg.addEventListener("click", () => dlg.close());   // one tap anywhere closes it
      document.body.append(dlg);
    }
    const shown = list.slice(0, max), groups = [];
    shown.forEach((x) => { const g = groups[groups.length - 1]; if (g && g.date === x.date) g.lines.push(x.text); else groups.push({ date: x.date, lines: [x.text] }); });
    const more = list.length - shown.length;
    dlg.innerHTML = `<h2>${esc(title)}</h2>${groups.map((g) => `<h3>${esc(dayLabel(g.date))}</h3><ul>${g.lines.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`).join("")}
      ${more > 0 ? `<p class="wn-more">and ${more} more in More › What's new</p>` : ""}<button type="button" class="wn-ok">Got it</button>`;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;   // the first line first, not scrolled down to the focused button
  }

  // Wait until the app has settled and nothing else is on screen (another popup, How it works, a ride).
  const busy = () => document.hidden || document.querySelector("dialog[open]") || (document.getElementById("about") && !document.getElementById("about").hidden) || document.querySelector(".riding");
  let lastCheck = 0;
  function check(tries = 6) {
    lastCheck = Date.now();
    load().then((list) => {
      if (!list.length) return;
      const seen = getSeen();
      if (!seen && !usedBefore) { markSeen(list); return; }   // first time on this device: nothing to catch up on
      const fresh = unseen(list, seen);
      if (!fresh.length) return;
      if (busy()) { if (tries > 0) setTimeout(() => check(tries - 1), 5000); return; }
      markSeen(list);
      show(fresh, "What's new");
    });
  }
  const start = () => setTimeout(() => check(), WAIT_MS);
  if (document.readyState === "complete") start(); else addEventListener("load", start, { once: true });
  // The iPhone app and home-screen app come back without reloading: check again when it's opened after a while.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - lastCheck > AGAIN_MS) setTimeout(() => check(), 800); });

  window.tfWhatsNew = { open: () => load().then((list) => { if (list.length) { markSeen(list); show(list, "What's new", 40); } }) };
})();
