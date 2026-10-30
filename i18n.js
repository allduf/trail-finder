// Language: English or French (alex, 2026-10-30: French for Quebec users). A phone set to French opens in French; the
// More page's Language switch overrides it (tf:lang). The French words (i18n-fr.js) load only for French, before the
// page's text is parsed, and translate the page as it's built and every time a script adds or changes text, so the
// other scripts keep writing English and need no change.
(function () {
  "use strict";
  var KEY = "tf:lang", lang = null;
  try { lang = localStorage.getItem(KEY); } catch (e) {}
  if (lang !== "fr" && lang !== "en") lang = /^fr/i.test((navigator.languages && navigator.languages[0]) || navigator.language || "") ? "fr" : "en";
  window.tfLang = {
    lang: lang,
    // Switching reloads the page: every script's text comes back in the new language at once.
    set: function (l) { try { localStorage.setItem(KEY, l); } catch (e) {} if (l !== lang) location.reload(); },
    t: function (s) { return s; },   // i18n-fr.js replaces it: a script's own text in the user's language
  };
  if (lang !== "fr") return;
  document.documentElement.lang = "fr-CA";
  var v = ((document.currentScript && document.currentScript.src) || "").match(/\?v=\d+/);
  document.write('<script src="i18n-fr.js' + (v ? v[0] : "") + '"><\/script>');
})();
