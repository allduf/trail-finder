// Keep the box being typed in above the phone keyboard, everywhere in the app (alex, 2026-10-26: "I want to see what
// I'm typing. Make sure every time I'm typing something we see what we type").
// The page never scrolls (html/body are fixed, the iPhone app has scrolling off), so the phone can't push the page up
// to show the box itself: the keyboard and its ^ v ✓ bar just cover it. While the keyboard is up, the box that scrolls
// around the field (the sheet, a column, a dialog) gets room under it and scrolls the field into the part of the
// screen above the keyboard. A search box goes to the top of that part, so its list of matches shows under it.
// Dialogs fit themselves above the keyboard. A field in a box that can't scroll lifts that box instead.
// Photo find (photo-find.js) has its own, older version of this and is left to it.
(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const TYPING = "textarea, select, [contenteditable=''], [contenteditable=true], input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]):not([type=reset]):not([type=color]):not([type=image]):not([type=hidden])";
  const css = document.createElement("style");
  css.textContent = `html.kb-up dialog[open] { margin-top: calc(var(--kb-top, 0px) + 8px) !important; margin-bottom: auto !important;
  top: 0 !important; bottom: 0 !important; transform: none !important; max-height: calc(var(--kb-h, 100vh) - 16px) !important; overflow-y: auto !important; }
.kb-room::after { content: ""; display: block; height: var(--kb-room, 0px); flex: none; }`;
  document.head.append(css);

  let field = null, aligned = false, timers = [];
  let padded = null, padPx = 0, lifted = null, liftWas = "", liftPx = 0;
  const kbUp = () => window.innerHeight - vv.height * vv.scale > 120;   // the keyboard, not the browser's bars
  const scrolls = (n) => /auto|scroll/.test(getComputedStyle(n).overflowY);
  function scrollerOf(el) {
    for (let n = el.parentElement; n && n !== document.body && n !== root; n = n.parentElement) if (scrolls(n)) return n;
    return null;
  }
  function unpad() { if (padded) { padded.classList.remove("kb-room"); padded.style.removeProperty("--kb-room"); padded = null; padPx = 0; } }
  function unlift() { if (lifted) { lifted.style.transform = liftWas; lifted = null; liftPx = 0; } }
  function reset() {
    root.classList.remove("kb-up");
    unpad(); unlift();
  }
  // A sticky title bar at the top of the scroller (the phone's page bar) covers what's scrolled under it.
  function stickyTop(sc) {
    const nb = document.getElementById("navBar");
    return nb && !nb.hidden && sc.contains(nb) ? nb.offsetHeight : 0;
  }
  function fit() {
    if (!field || document.activeElement !== field || !field.isConnected) { field = null; reset(); return; }
    if (!kbUp()) { reset(); return; }
    root.classList.add("kb-up");
    root.style.setProperty("--kb-top", vv.offsetTop + "px");
    root.style.setProperty("--kb-h", vv.height + "px");
    const visTop = vv.offsetTop + 8, visBot = vv.offsetTop + vv.height - 10;
    const sc = scrollerOf(field);
    if (sc) {
      const s = sc.getBoundingClientRect();
      // room under the last thing in it, as tall as the part of it behind the keyboard (an empty block, not padding:
      // padding would also lift the buttons that stick to its bottom, like Find new trails, over the field)
      const under = Math.ceil(s.bottom - visBot);
      if (padded !== sc) { unpad(); padded = sc; sc.classList.add("kb-room"); }
      if (under > padPx) { padPx = under; sc.style.setProperty("--kb-room", under + "px"); }
      const top = Math.max(visTop, s.top + stickyTop(sc) + 6), bot = Math.min(visBot, s.bottom - 6);
      const r = field.getBoundingClientRect();
      let by = 0;
      if (!aligned && field.matches("input[type=search], [role=combobox]")) by = r.top - top;   // matches show under it
      else if (r.bottom > bot) by = Math.min(r.bottom - bot, r.top - top);   // its bottom into view, never its top out
      else if (r.top < top) by = r.top - top;
      if (Math.abs(by) > 1) sc.scrollTop += by;
      aligned = true;
    }
    // Still behind the keyboard (no scrolling box, or it ran out): lift the floating box it's in.
    const r = field.getBoundingClientRect(), short = r.bottom - visBot;
    if (short > 1) {
      let box = null;
      for (let n = field.parentElement; n && n !== document.body; n = n.parentElement) {
        const p = getComputedStyle(n).position;
        if ((p === "fixed" || p === "absolute") && !n.classList.contains("app") && n.tagName !== "DIALOG") box = n;
        if (p === "fixed") break;
      }
      if (box && box !== lifted) { unlift(); lifted = box; liftWas = box.style.transform; }
      if (lifted) {
        liftPx = Math.max(0, Math.min(liftPx + short, liftPx + lifted.getBoundingClientRect().top - visTop));   // never past the top
        lifted.style.transform = liftPx ? `translateY(${-liftPx}px)` : liftWas;
      }
    }
  }
  function soon() {
    timers.forEach(clearTimeout);
    timers = [0, 80, 320, 650].map((ms) => setTimeout(fit, ms));   // the keyboard slides up over about 300 ms
  }
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (!(el instanceof Element) || !el.matches(TYPING) || el.closest("#photoFind")) return;
    if (el !== field) { field = el; aligned = false; }
    soon();
  });
  document.addEventListener("focusout", () => setTimeout(() => {
    const a = document.activeElement;
    if (a && a.matches && a.matches(TYPING) && !a.closest("#photoFind")) return;   // moved to the next box (^ v)
    field = null; reset();
  }, 120));
  vv.addEventListener("resize", () => { if (field) fit(); else if (root.classList.contains("kb-up")) reset(); });
  vv.addEventListener("scroll", () => { if (field) fit(); });
  // a note growing line by line keeps its last line in view
  document.addEventListener("input", (e) => { if (e.target === field && field.tagName === "TEXTAREA") fit(); });
})();
