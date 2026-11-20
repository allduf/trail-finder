// Avalanche in the iPhone's own 3D map (native 3D, step 8; alex 2026-11-20: every web feature in native 3D, avalanche
// last and exact). The slope colours are winter.js's own paint(), sent as lossless PNGs by native-ground.js ("avy" in
// window.tfGround). This file sends the avalanche card that goes with them (NativeAvalanche.swift), read from the
// page's own card (#avCard, winter.js) word for word: the area, every warning (example, expired, an old copy, no
// forecast), the three band ratings with Avalanche Canada's colours, and the notes on what the colours mean. Nothing is
// worked out here, so the native card can never say anything the page's card doesn't.
//   "avy": JSON { on, title, warn: [..], bands: [{ r, n, c, t }], line, notes: [..] } (on: false = no card), sent at
//          opening and whenever the page's card changes (the map moved to another area, a new day picked...).
//   "avyReady" from the native map: this app build shows the card, so the colours may be sent to it ("tf-native-avy").
//   "closed" with avy: true: "Full forecast" on the native card; the page's card is opened.
// On the website, and in app builds without native 3D, this file does nothing.
(() => {
  "use strict";
  const C = window.Capacitor, N = window.tfNative;
  if (!C || !C.isNativePlatform || !C.isNativePlatform() || !N || !N.addLayer || !N.on) return;
  const card = () => document.getElementById("avCard");
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const avyOn = () => { try { return JSON.parse(localStorage.getItem("tf:avy") || "false") === true; } catch { return false; } };
  function state() {
    const c = card(), on = document.body.classList.contains("sport-ski") && avyOn() && !!c && !c.hidden;
    if (!on) return JSON.stringify({ on: false });
    const where = txt(c.querySelector(".av-top .av-where"));
    const bands = [...c.querySelectorAll(".av-bands .av-band")].map((b) => ({
      r: txt(b.querySelector("b")), n: txt(b.querySelector("span")),
      c: b.style.getPropertyValue("--c").trim(), t: b.style.getPropertyValue("--t").trim(),
    }));
    const notes = [...c.querySelectorAll("#avMore > p.sk-note")].map(txt).filter((s) => /^(Darker shade|Slopes of 25)/.test(s));
    return JSON.stringify({
      on: true, title: where,
      warn: [...c.querySelectorAll(".av-warn")].map(txt).filter(Boolean),
      bands, line: txt(c.querySelector(".av-line")), notes,
    });
  }
  N.addLayer("avy", state);
  let sent = "", t = 0;
  const changed = () => {
    if (!N.isOpen() || t) return;
    t = setTimeout(() => { t = 0; const s = state(); if (s !== sent) { sent = s; N.send("avy"); } }, 250);
  };
  const watch = () => { const c = card(); if (c) new MutationObserver(changed).observe(c, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "style"] }); };
  if (card()) watch(); else window.addEventListener("load", watch, { once: true });
  window.addEventListener("tf:ground", changed);
  N.on("avyReady", () => {
    let first = false;
    try { first = localStorage.getItem("tf-native-avy") !== "1"; localStorage.setItem("tf-native-avy", "1"); } catch {}
    sent = "";
    N.send("avy");
    if (first) window.dispatchEvent(new Event("tf:ground"));   // now the colours can go too
  });
  N.on("closed", (e) => {
    if (!e || !e.avy) return;
    const c = card();
    if (c && !c.hidden && window.tfPanelScrollTo) setTimeout(() => window.tfPanelScrollTo(c), 300);
  });
})();
