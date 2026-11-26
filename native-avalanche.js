// Avalanche in the iPhone's own 3D map (native 3D, step 8; alex 2026-11-20: every web feature in native 3D, avalanche
// last and exact). The slope colours are winter.js's own paint(), sent as lossless PNGs by native-ground.js ("avy" in
// window.tfGround). This file sends the avalanche card that goes with them (NativeAvalanche.swift), read from the
// page's own card (#avCard, winter.js) word for word: the area, every warning (example, expired, an old copy, no
// forecast), the three band ratings with Avalanche Canada's colours, and the notes on what the colours mean. Nothing is
// worked out here, so the native card can never say anything the page's card doesn't.
//   "avy": JSON { on, title, warn: [..], bands: [{ r, n, c, t }], line, notes: [..] } (on: false = no card), sent at
//          opening and whenever the page's card changes (the map moved to another area, a new day picked...).
//          days: [{ t, on }] the page card's day buttons (only when it has them), in order.
//          spot: { lat, lon, n, title, rows } (or none; n: the native map's own number for that tap): a slope tapped on the native map, the same top and Avalanche danger
//          part as This spot on the page (winter.js tfSkiAvySpot, the same functions), read from that HTML in the page's
//          language; rows null while the terrain is read. Rows: { k: "h"|"p"|"note"|"warn"|"chip"|"check"|"stats"|
//          "days"|"prob"|"sign"|"li"|"link", t, ... } (see spotRows).
//   "avyReady" from the native map: this app build shows the card, so the colours may be sent to it ("tf-native-avy").
//   "avyDay" { i } from the native map: a day pressed on the native card; the page card's own button i is pressed, so
//          the colours, the card and the slope card all follow it exactly as on the page.
//   "avyTap" { lat, lon }: the native map tapped beside every trail and pin while the card shows: that slope's card.
//   "avySpot" { close: true }: the slope card closed (its ✕, or another tap on the map).
//   "closed" with avy: true: "Full forecast" on the native card; the page's card is opened. With avySpot: true (and
//          spotLat, spotLon): "This spot" on the slope card; the page's This spot card opens there.
// On the website, and in app builds without native 3D, this file does nothing.
(() => {
  "use strict";
  const C = window.Capacitor, N = window.tfNative;
  if (!C || !C.isNativePlatform || !C.isNativePlatform() || !N || !N.addLayer || !N.on) return;
  const card = () => document.getElementById("avCard");
  let spot = null, spotSeq = 0, host = null;   // a slope tapped on the native map (see spotRows)
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const T = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);
  const avyOn = () => { try { return JSON.parse(localStorage.getItem("tf:avy") || "false") === true; } catch { return false; } };
  function state() {
    const c = card(), on = document.body.classList.contains("sport-ski") && avyOn() && !!c && !c.hidden;
    if (!on) { spot = null; return JSON.stringify({ on: false }); }   // a slope card goes with the avalanche card
    const where = txt(c.querySelector(".av-top .av-where"));
    const bands = [...c.querySelectorAll(".av-bands .av-band")].map((b) => ({
      r: txt(b.querySelector("b")), n: txt(b.querySelector("span")),
      c: b.style.getPropertyValue("--c").trim(), t: b.style.getPropertyValue("--t").trim(),
    }));
    // What the colours and the stripes mean, and the treeline estimate (marked av-native in winter.js), in the
    // page's language.
    const notes = [...c.querySelectorAll("#avMore > p.av-native")].map(txt).filter(Boolean);
    return JSON.stringify({
      on: true, title: where,
      // The day the ratings and colours are for, when the forecast has several (the page's pressed day).
      day: txt(c.querySelector(".av-days button[aria-pressed=\"true\"]")),
      // The card's own words, in the page's language (scripts/i18n/fr-native-avalanche.txt).
      words: { avy: T("Avalanche"), more: T("Full forecast"), tap: T("Tap for what the colours mean") },
      warn: [...c.querySelectorAll(".av-warn")].map(txt).filter(Boolean),
      bands, line: txt(c.querySelector(".av-line")), notes,
      days: [...c.querySelectorAll(".av-days button")].map((b) => ({ t: txt(b), on: b.getAttribute("aria-pressed") === "true" })),
      spot: spot ? { lat: spot.lat, lon: spot.lon, n: spot.n, title: T("This spot"), more: T("More about this spot"), loading: T("Reading the terrain…"), rows: spot.rows } : null,
    });
  }
  // ---------- a slope tapped on the native map ----------
  // The page's own This spot HTML, put in a hidden box on the page so the French words go in as on the page, then read
  // row by row. Colours come from the HTML's own styles (Avalanche Canada's danger colours, the slope and terrain colours).
  const styleOf = (el, k) => (el ? (el.style.getPropertyValue(k) || "").trim() : "");
  function spotRows(root) {
    const rows = [];
    const add = (r) => { if (r.t || r.d) rows.push(r); };
    for (const el of root.children) {
      const tag = el.tagName, cl = el.classList;
      if (/^H[3-5]$/.test(tag)) add({ k: "h", t: txt(el) });
      else if (cl.contains("av-warn") || cl.contains("sk-warn")) add({ k: "warn", t: txt(el) });
      else if (cl.contains("sk-check")) add({ k: "check", t: txt(el.querySelector("b")), s: txt(el.querySelector("span")), c: styleOf(el, "--c") });
      else if (cl.contains("sk-stats")) add({ k: "stats", d: [...el.children].map((x) => ({ t: txt(x.querySelector("b")), s: txt(x.querySelector("span")), c: styleOf(x, "--c") })) });
      else if (cl.contains("sk-spotdays")) add({ k: "days", d: [...el.children].map((x) => { const ch = x.querySelector(".av-chip"); return { n: txt(x.querySelector("span")), t: txt(ch), c: styleOf(ch, "background-color"), f: styleOf(ch, "color") }; }) });
      else if (cl.contains("av-prob")) {
        const body = el.querySelector(":scope > div");
        add({ k: "prob", t: txt(body && body.querySelector("b")), off: cl.contains("off"), d: body ? [...body.querySelectorAll(":scope > p")].map(txt).filter(Boolean) : [] });
      } else if (tag === "UL") for (const li of el.children) add({ k: cl.contains("sk-signs") ? "sign" : "li", t: txt(li), hi: li.classList.contains("hi") });
      else if (tag === "P") {
        const a = el.querySelector("a[href^='http']"), ch = el.querySelector(".av-chip");
        if (a && txt(a) === txt(el)) add({ k: "link", t: txt(a), u: a.href });
        else if (ch) add({ k: "chip", t: txt(el), c: styleOf(ch, "background-color"), f: styleOf(ch, "color") });
        else add({ k: cl.contains("sk-note") ? "note" : "p", t: txt(el) });
        if (a && txt(a) !== txt(el)) add({ k: "link", t: txt(a), u: a.href });   // a link inside a sentence: its own row too
      } else add({ k: "p", t: txt(el) });
    }
    return rows;
  }
  // Writes the slope card for the day shown now; then() once its rows are read (after the French pass).
  function spotFill(then) {
    const A = window.tfSkiAvySpot;
    if (!spot || !spot.s) { if (then) then(); return; }
    const seq = spotSeq;
    let h = null;
    try { h = A && A.html ? A.html(spot.lat, spot.lon, spot.s) : null; } catch {}
    if (!h) { spot.rows = [{ k: "note", t: T("Couldn't read the terrain here (no connection?).") }]; if (then) then(); return; }
    if (!host) { host = document.createElement("div"); host.hidden = true; host.id = "tfNativeSpot"; document.body.append(host); }
    host.innerHTML = `<div>${h.ground}</div><div>${h.avy}</div>`;
    setTimeout(() => {   // the page's French pass runs on new text first (i18n)
      if (seq === spotSeq && spot) spot.rows = [...host.children].flatMap(spotRows);
      host.innerHTML = "";
      if (then) then();   // always: the card and the colours go together even when the slope card closed meanwhile
    }, 0);
  }
  const sendNow = () => { if (!N.isOpen()) return; const s = state(); if (s !== sent) { sent = s; N.send("avy"); } };
  N.addLayer("avy", state);
  let sent = "", t = 0;
  const changed = () => {
    if (!N.isOpen() || t) return;
    // The card and the colours go together (the ground state carries the colours' version): never one forecast's card
    // over another forecast's colours.
    t = setTimeout(() => { t = 0; spotFill(() => { const s = state(); if (s !== sent) { sent = s; N.send("avy"); N.send("ground"); } }); }, 250);
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
  // A day pressed on the native card: the page card's own button, so everything follows it as on the page.
  N.on("avyDay", (e) => {
    const c = card(), b = c && !c.hidden && c.querySelectorAll(".av-days button")[Number(e.i)];
    if (b) b.click();
  });
  N.on("avyTap", (e) => {
    const lat = Number(e.lat), lon = Number(e.lon), A = window.tfSkiAvySpot;
    if (!isFinite(lat) || !isFinite(lon) || !A || !A.ground || JSON.parse(state()).on !== true) return;
    const seq = ++spotSeq;
    spot = { lat, lon, n: Number(e.n) || 0, s: null, rows: null };
    sendNow();
    A.ground(lat, lon).then((s) => {
      if (seq !== spotSeq || !spot) return;
      spot.s = s;
      spotFill(sendNow);
    }, () => {
      if (seq !== spotSeq || !spot) return;
      spot.rows = [{ k: "note", t: T("Couldn't read the terrain here (no connection?).") }];
      sendNow();
    });
  });
  N.on("avySpot", (e) => { if (e && e.close) { spotSeq++; spot = null; sent = ""; } });
  N.on("closed", (e) => {
    spotSeq++; spot = null;   // the native map left: its slope card goes with it
    if (e && e.avySpot) {
      const lat = Number(e.spotLat), lon = Number(e.spotLon);
      if (isFinite(lat) && isFinite(lon) && window.tfSkiSpot) setTimeout(() => window.tfSkiSpot(lat, lon), 300);
      return;
    }
    if (!e || !e.avy) return;
    const c = card();
    if (!c || c.hidden) return;
    const more = c.querySelector("#avMore");
    if (more && !more.open) more.open = true;   // the problems, notes and reports, unfolded (its toggle keeps it open)
    setTimeout(() => { if (window.tfPanelScrollTo) window.tfPanelScrollTo(c); else c.scrollIntoView({ block: "start" }); }, 300);
  });
})();
