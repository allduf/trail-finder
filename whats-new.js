// What's new (alex, 2026-10-24: "every time a user opens the app show a list of what changed since they last
// connected... simple and quick to read"). When the app opens or comes back to the front, a small card lists the
// changes since this rider last saw it: one short line each, one tap anywhere closes it, nothing shows when nothing changed.
//  - The lines are data/changelog.json (newest first: { date: "YYYY-MM-DD", text }). For each change people will notice,
//    add a new file data/changelog.d/<short-name>.json instead; scripts/stamp.mjs puts it in at publish (2026-11-19).
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
dialog.wnew button.wn-all { display: block; margin: 10px 0 0; padding: 6px 0; font: inherit; font-size: .88rem; font-weight: 700; color: var(--accent); background: none; border: 0; cursor: pointer; }
dialog.wnew button.wn-ok { display: block; width: 100%; margin-top: 12px; font: inherit; font-weight: 700; padding: 11px; border-radius: 12px; border: 0; background: var(--cta); color: var(--cta-fg); cursor: pointer; }`;
  document.head.append(css);

  // Each sport sees its own lines (deep phone test 2026-11-21: Hunting listed Skiing's and Fishing's changes). A line
  // belongs to a sport when it starts with that sport's name, as the changelog lines do ("Skiing: ...", "Fishing: ...");
  // any other line is about the whole app and shows in every sport. More › What's new can still show every sport.
  const SPORT_OF = [
    ["ski", /^(Skiing|Ski |Cabin trip|Shared cabin trip|Avalanche|Lift status|Lift cards|Webcams|Japan|Planning a ski tour)/i],
    ["fish", /^Fishing/i], ["hunt", /^Hunting/i], ["moto", /^(Adventure moto|ADV\b|Moto\b)/i],
    ["hike", /^(Hiking|Hike |Offline maps for Hiking|Plan a hike)/i],
    ["mtb", /^(MTB|Mountain biking|Prime loam|Loam|Bike trips|Bike parks?\b|Which trail|Photo find)/i],
  ];
  // "Hunting and fishing: ..." names two sports: it's for everyone.
  const oneSport = (t) => { for (const [s, re] of SPORT_OF) if (re.test(t)) return s; return ""; };
  const lineSport = (t) => {
    const head = /^([^:]{1,50}):/.exec(t), named = head ? new Set(head[1].split(/,| and /i).map((x) => oneSport(x.trim())).filter(Boolean)) : null;
    return named && named.size > 1 ? "" : oneSport(t);
  };
  const curSport = () => { const el = document.getElementById("sport"); return (el && el.value) || "mtb"; };
  const forSport = (list) => { const sp = curSport(); return list.filter((x) => { const s = lineSport(x.text); return !s || s === sp; }); };
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

  function show(list, title, max = MAX, all = null) {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "wnew";
      dlg.addEventListener("click", (e) => {   // one tap anywhere closes it, but Every sport
        if (e.target.closest(".wn-all")) { e.stopPropagation(); if (dlg._all) show(dlg._all, "What's new", 40); return; }
        dlg.close();
      });
      document.body.append(dlg);
    }
    dlg._all = all;
    const others = all ? all.length - list.length : 0;
    const shown = list.slice(0, max), groups = [];
    shown.forEach((x) => { const g = groups[groups.length - 1]; if (g && g.date === x.date) g.lines.push(x.text); else groups.push({ date: x.date, lines: [x.text] }); });
    const more = list.length - shown.length;
    dlg.innerHTML = `<h2>${esc(title)}</h2>${groups.map((g) => `<h3>${esc(dayLabel(g.date))}</h3><ul>${g.lines.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`).join("")}
      ${more > 0 ? `<p class="wn-more">and ${more} more in More › What's new</p>` : ""}${others > 0 ? `<button type="button" class="wn-all">Show every sport's changes too</button>` : ""}<button type="button" class="wn-ok">Got it</button>`;
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
      const all = unseen(list, seen), fresh = forSport(all);
      if (!fresh.length) return;   // nothing new for this sport: no card, and the other sports' lines stay unread for now
      if (busy()) { if (tries > 0) setTimeout(() => check(tries - 1), 5000); return; }
      markSeen(list);
      // Your sport's lines and the whole app's; the other sports' new lines are one tap away, not left unread.
      show(fresh, "What's new", MAX, all);
    });
  }
  const start = () => setTimeout(() => check(), WAIT_MS);
  if (document.readyState === "complete") start(); else addEventListener("load", start, { once: true });
  // The iPhone app and home-screen app come back without reloading: check again when it's opened after a while.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - lastCheck > AGAIN_MS) setTimeout(() => check(), 800); });

  window.tfWhatsNew = { open: () => load().then((list) => { if (list.length) { markSeen(list); show(forSport(list), "What's new", 40, list); } }) };
})();
