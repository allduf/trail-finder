// Language: English or French (alex, 2026-10-30: French for Quebec users). A phone set to French opens in French; the
// More page's Language switch overrides it (tf:lang). The French words (i18n-fr.js) load only for French, before the
// page's text is parsed, and translate the page as it's built and every time a script adds or changes text, so the
// other scripts keep writing English and need no change.
// One page reload at a time (window.tfReload, used by account.js, friends.js, native.js and here). A second reload while
// the first is loading cancels it, and the iPhone and Android apps then showed their "No connection" page for a
// second (alex's sign-in recording, 2026-11-21: sign-in reloads for the account's settings and the friend check).
// A reload that never finished (cancelled) lets the next one through after 10 s.
window.tfReload = window.tfReload || function () {
  if (window.tfReloading) return;
  window.tfReloading = true; setTimeout(function () { window.tfReloading = false; }, 10000);
  location.reload();
};
// Why something failed, in plain words for the interface (CLAUDE.md: no raw error codes): never a browser's "Failed to
// fetch", an "HTTP 503" or a script's own error. A sentence the app wrote itself is kept. Used as "Couldn't load X (...)".
window.tfErrText = window.tfErrText || function (e) {
  var m = String((e && (e.message || e.error_description)) || e || "");
  if (navigator.onLine === false) return "no signal";
  if (/too many|\b429\b/i.test(m)) return "too many requests just now";
  if (/HTTP 404/.test(m)) return "not found";
  if (/HTTP 4\d\d/.test(m)) return "the server turned the request down";
  if (/HTTP|fetch|load failed|network|abort|timed? ?out/i.test(m)) return "no answer from the server";
  if (!m || /[A-Z][a-z]+Error\b|undefined|null|NaN|JSON|token|is not a function|Cannot read|is not defined|violates|\bpolicy\b/.test(m)) return "something went wrong";
  return m.replace(/[.\s]+$/, "");
};
(function () {
  "use strict";
  var KEY = "tf:lang", lang = null;
  try { lang = localStorage.getItem(KEY); } catch (e) {}
  if (lang !== "fr" && lang !== "en") lang = /^fr/i.test((navigator.languages && navigator.languages[0]) || navigator.language || "") ? "fr" : "en";
  window.tfLang = {
    lang: lang,
    // Switching reloads the page: every script's text comes back in the new language at once.
    set: function (l) { try { localStorage.setItem(KEY, l); } catch (e) {} if (l !== lang) window.tfReload(); },
    t: function (s) { return s; },   // i18n-fr.js replaces it: a script's own text in the user's language
  };
  if (lang !== "fr") return;
  document.documentElement.lang = "fr-CA";
  var v = ((document.currentScript && document.currentScript.src) || "").match(/\?v=\d+/);
  document.write('<script src="i18n-fr.js' + (v ? v[0] : "") + '"><\/script>');
})();
