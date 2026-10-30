  // ---- the translator (from scripts/i18n/engine.js) ----
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };
  var ATTRS = ["placeholder", "title", "aria-label"];
  // A text is looked up whole, then without what's around its words: icons and arrows in front ("🚵 Ride", "← Back"),
  // punctuation after ("Avalanche:"), so one entry covers every way the app shows it.
  var EDGE = /^([^A-Za-z0-9]*?)([A-Za-z0-9][\s\S]*?)([\s.:;,…!?)]*)$/;
  function look(k) {
    var f = D[k];
    if (f !== undefined) return f;
    for (var i = 0; i < R.length; i++) if (R[i][0].test(k)) return k.replace(R[i][0], R[i][1]);
    return null;
  }
  function tr(s) {
    if (!s || s.length > 600) return null;
    var k = s.replace(/\s+/g, " ").trim();
    if (!k || !/[A-Za-z]/.test(k)) return null;
    var f = look(k);
    if (f == null && k.indexOf(" · ") > 0) {
      // Facts joined with " · " ("1 in all · 60 cm or more · Angling only"): each piece on its own.
      var ps = k.split(" · "), hit = false;
      for (var i = 0; i < ps.length; i++) { var g = tr(ps[i]); if (g != null) { ps[i] = g.trim(); hit = true; } }
      if (hit) f = ps.join(" · ");
    }
    if (f == null) {
      var m = EDGE.exec(k);
      if (!m || (!m[1] && !m[3])) return null;
      f = look(m[2]);
      if (f == null && m[3]) { f = look(m[2] + m[3].trim()); if (f != null) m[3] = ""; }
      if (f == null) return null;
      f = m[1] + f + m[3];
    }
    if (f === k) return null;
    // Keep the spaces around it: text pieces sit next to links and bold words.
    var lead = /^\s*/.exec(s)[0], tail = /\s*$/.exec(s)[0];
    return lead + f + tail;
  }
  function keep(el) { return el && el.closest && el.closest('[translate="no"],.notranslate'); }
  function doText(n) {
    var p = n.parentNode;
    if (!p || SKIP[p.nodeName] || p.isContentEditable) return;
    var f = tr(n.nodeValue);
    if (f != null && f !== n.nodeValue && !keep(p)) n.nodeValue = f;
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (v) { var f = tr(v); if (f != null && f !== v && !keep(el)) el.setAttribute(ATTRS[i], f); }
    }
    if (el.nodeName === "INPUT" && (el.type === "button" || el.type === "submit") && el.value) { var g = tr(el.value); if (g != null) el.value = g; }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    doAttrs(root);   // a text box's hint too (its typed text is left alone)
    if (SKIP[root.nodeName]) return;
    var w = document.createTreeWalker(root, 5 /* elements and text */), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else if (n.hasAttribute && (n.hasAttribute("title") || n.hasAttribute("placeholder") || n.hasAttribute("aria-label") || n.nodeName === "INPUT")) doAttrs(n);
    }
  }
  var mo = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.type === "childList") for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
      else if (r.type === "characterData") doText(r.target);
      else if (r.type === "attributes") doAttrs(r.target);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  document.addEventListener("DOMContentLoaded", function () { walk(document.body); });
  window.tfLang.t = function (s) { var f = tr(String(s)); return f == null ? s : f; };
  // Alerts and confirm boxes the scripts open.
  ["alert", "confirm", "prompt"].forEach(function (k) {
    var o = window[k]; if (!o) return;
    window[k] = function (m) { var a = [].slice.call(arguments); a[0] = window.tfLang.t(m); return o.apply(window, a); };
  });
  // Words the style sheets write (the map's Me button, layers' On/Off, the Today cards, ride folders).
  var css = document.createElement("style"), F = 'html[lang="fr-CA"] ';
  css.textContent = "@media (max-width: 760px) { " + F + "body .map-tools #locate::after { content: \"Moi\"; } " +
    F + "body :is(#skNow, #hnNow, #fsNow, #mtNow, .hub-now, .peek-today):not([hidden])::before { content: \"Aujourd'hui\"; } } " +
    F + ".map-tools .layers-menu .lm-overlays button::after { content: \"Non\"; } " + F + ".map-tools .layers-menu .lm-overlays button.on::after { content: \"Oui\"; } " +
    F + ".rfolder[open] > summary .tog::before { content: \"Fermer ▴\"; } " + F + ".rfolder:not([open]) > summary .tog::before { content: \"Ouvrir ▾\"; }";
  (document.head || document.documentElement).appendChild(css);
