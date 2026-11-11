// Tutorials (alex, 2026-11-11: "a place with multiple tutorial video that shows you how to use every feature"). One list
// of short vertical videos, one per feature, opened from More › Tutorials (the computer's ☰ Menu too), from the top of
// How it works, and from a "Watch how" button inside each feature that has a video (cabin-trip.js uses button()).
//  - The videos are in videos/ (720 × 1280 H.264, +faststart, ~8 MB a minute and a half). Nothing is downloaded when the
//    app opens: the list's small pictures come when the list is opened, a video only when it is tapped.
//  - sw.js leaves videos/ alone (no saved copy): iPhones ask for a video in pieces (Range), which a saved copy can't answer.
//  - To add a video: put the .mp4 (and a .jpg of one frame for its picture) in videos/, add one line to LIST below, and
//    its title and sub in French to scripts/i18n/fr-N.txt. A feature's own "Watch how" button: tfTutorials.button(id).
//  - window.tfTutorials = { list, open(id), button(id, label) }: open() shows the list, open(id) plays that video.
(() => {
  "use strict";
  if (window.tfTutorials) return;
  // sport: the line icon and heading it's listed under (mtb, ski, hunt, fish, moto, hike, or all for the whole app).
  // Empty until alex picks the videos (2026-11-11: "dont put any video in until i tell you which one to put"). While it's
  // empty, nothing shows: no More › Tutorials, no button in How it works, no Watch how in a feature. A line looks like:
  //   { id: "cabin-trip", sport: "ski", title: "Plan a cabin trip", sub: "Pick a hut, the way in, your group, packing, meals and costs, then share the trip", src: "videos/cabin-trip.mp4", poster: "videos/cabin-trip.jpg", secs: 92 },
  const LIST = [
  ];
  const SPORTS = { all: ["The whole app", "✨"], mtb: ["MTB", "🚵"], ski: ["Skiing", "⛷"], hunt: ["Hunting", "🦌"], fish: ["Fishing", "🎣"], moto: ["Adventure moto", "🏍"], hike: ["Hiking", "🥾"] };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const line = (e, size = 18) => (window.tfLine ? window.tfLine(e, size) : e);
  const len = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const curSport = () => { const s = document.getElementById("sport"); return s ? s.value : "mtb"; };

  const css = document.createElement("style");
  css.textContent = `
dialog.tut { border: 1px solid var(--line); border-radius: 16px; background: var(--panel); color: var(--fg); padding: 14px 14px 12px; width: min(440px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; box-sizing: border-box; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.tut::backdrop { background: rgba(0,0,0,.5); }
dialog.tut .tut-top { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; }
dialog.tut h2 { margin: 0; flex: 1; font-family: var(--font-display); font-size: 1.2rem; line-height: 1.2; }
dialog.tut .tut-x, dialog.tut .tut-back { font: inherit; border: 0; background: none; color: var(--fg); cursor: pointer; padding: 8px; margin: -8px; min-width: 40px; min-height: 40px; border-radius: 10px; }
dialog.tut .tut-back { color: var(--accent); font-weight: 700; display: inline-flex; align-items: center; gap: 2px; padding-right: 10px; min-width: 0; }
dialog.tut h3 { display: flex; align-items: center; gap: 6px; margin: 12px 0 4px; font-size: .74rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
dialog.tut ul { list-style: none; margin: 0; padding: 0; }
dialog.tut li + li { border-top: 1px solid var(--line); }
dialog.tut .tut-row { display: flex; gap: 12px; align-items: center; width: 100%; text-align: left; font: inherit; color: inherit; background: none; border: 0; padding: 8px 0; cursor: pointer; }
dialog.tut .tut-pic { position: relative; flex: 0 0 auto; width: 54px; height: 96px; border-radius: 8px; overflow: hidden; background: var(--line); }
dialog.tut .tut-pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
dialog.tut .tut-pic .tut-play { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; filter: drop-shadow(0 1px 3px rgba(0,0,0,.6)); }
dialog.tut .tut-tx { display: grid; gap: 2px; min-width: 0; }
dialog.tut .tut-tx b { font-size: 1rem; }
dialog.tut .tut-tx small { color: var(--muted); font-size: .86rem; line-height: 1.3; }
dialog.tut .tut-tx .tut-len { color: var(--muted); font-size: .8rem; font-variant-numeric: tabular-nums; }
dialog.tut .tut-note { color: var(--muted); font-size: .82rem; line-height: 1.35; margin: 10px 0 0; }
dialog.tut video { display: block; width: 100%; max-height: calc(100dvh - 150px); aspect-ratio: 9 / 16; object-fit: contain; background: #000; border-radius: 12px; margin: 0 auto; }
dialog.tut .tut-sub { color: var(--muted); font-size: .88rem; line-height: 1.3; margin: 8px 0 0; }
.tut-watch { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-weight: 700; font-size: .92rem; color: var(--accent); background: none; border: 0; padding: 8px 0; cursor: pointer; }
.tut-watch small { color: var(--muted); font-weight: 400; }`;
  document.head.append(css);

  let dlg = null;
  function stop() {
    const v = dlg && dlg.querySelector("video");
    if (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch {} }   // stops the download too
  }
  function ensure() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "tut";
    dlg.setAttribute("aria-labelledby", "tutTitle");
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) { dlg.close(); return; }   // a tap outside the card
      if (e.target.closest(".tut-x")) { dlg.close(); return; }
      if (e.target.closest(".tut-back")) { stop(); showList(); return; }
      const r = e.target.closest("[data-tut]");
      if (r) play(r.dataset.tut);
    });
    dlg.addEventListener("close", stop);
    document.body.append(dlg);
    return dlg;
  }
  const head = (title, back) => `<div class="tut-top">${back ? `<button type="button" class="tut-back" aria-label="All tutorials"><span aria-hidden="true">‹</span><span>Tutorials</span></button>` : ""}<h2 id="tutTitle">${esc(title)}</h2><button type="button" class="tut-x" aria-label="Close">✕</button></div>`;
  function showList() {
    // the sport you're in first, then the rest in the Sport button's order
    const order = Object.keys(SPORTS).sort((a, b) => (b === curSport()) - (a === curSport()));
    const groups = order.map((s) => [s, LIST.filter((t) => t.sport === s)]).filter(([, l]) => l.length);
    dlg.innerHTML = head("Tutorials") + groups.map(([s, l]) => `<h3>${line(SPORTS[s][1], 14)}${esc(SPORTS[s][0])}</h3><ul>${l.map((t) => `<li><button type="button" class="tut-row" data-tut="${esc(t.id)}">
      <span class="tut-pic">${t.poster ? `<img src="${esc(t.poster)}" alt="" loading="lazy" decoding="async">` : ""}<span class="tut-play">${line("▶", 26)}</span></span>
      <span class="tut-tx"><b>${esc(t.title)}</b><small>${esc(t.sub)}</small><span class="tut-len">${len(t.secs)}</span></span></button></li>`).join("")}</ul>`).join("")
      + `<p class="tut-note">Short videos showing how the app works, with example trips. The app may look a little different from the video.</p>`;
    dlg.scrollTop = 0;
  }
  function play(id) {
    const t = LIST.find((x) => x.id === id);
    if (!t) { showList(); return; }
    // preload="auto" only now that it was tapped; playsinline keeps it in the card on iPhones (the ⤢ in its controls
    // still goes full screen).
    dlg.innerHTML = head(t.title, LIST.length > 1) + `<video controls playsinline preload="auto" ${t.poster ? `poster="${esc(t.poster)}" ` : ""}src="${esc(t.src)}"></video><p class="tut-sub">${esc(t.sub)}</p>`;
    dlg.scrollTop = 0;
    const v = dlg.querySelector("video");
    const p = v.play();   // a tap started this, so phones let it play with sound
    if (p && p.catch) p.catch(() => {});
    v.addEventListener("error", () => { if (window.tfToast) window.tfToast("Couldn't load the video. Try again with signal."); }, { once: true });
  }
  function open(id) {
    ensure();
    if (id) play(id); else showList();
    if (!dlg.open) dlg.showModal();
  }
  // A feature's own "Watch how" button (empty when that feature has no video yet). Clicks are caught below.
  function button(id, label = "Watch how it works") {
    const t = LIST.find((x) => x.id === id);
    return t ? `<button type="button" class="tut-watch" data-tut-open="${esc(id)}">${line("▶", 18)}<span>${esc(label)}</span><small>${len(t.secs)}</small></button>` : "";
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tut-open]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const a = document.getElementById("about");
    if (a && !a.hidden && a.contains(b)) a.hidden = true;   // from How it works: the list takes its place
    open(b.dataset.tutOpen || undefined);
  }, true);
  // How it works' own button (index.html #about): shown once there is a video, with the same line ▶.
  const ab = document.querySelector("#about .about-tut");
  if (ab && LIST.length) { ab.hidden = false; ab.querySelector("button").insertAdjacentHTML("afterbegin", line("▶", 18)); }
  window.tfTutorials = { list: LIST, open, button };
})();
