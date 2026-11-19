// Ask for an App Store / Google Play rating at a happy moment (alex 2026-11-19: "Ask for a rating at a happy moment,
// like after a saved ride ... add that"). App builders agree on the same few rules, kept here:
// - Only in the iPhone and Android apps (the TrailReview plugin, ios-app/ and android-app/plugins). The website never
//   asks: it has no store page to rate.
// - Only right after something went well, in that sport's own words: a ride or route saved, a tour or trip planned, a
//   catch or a hunting log entry added, an area saved for no signal, a spot saved. Pages call
//   window.tfHappy("kind") there. Never after an error, never on first open.
// - Only for people who know the app: used on 3 different days, first used 7 or more days ago, and this is at least
//   their 2nd happy moment.
// - Rarely: at most once per app version, 120 days apart, 3 times a year (the phone also caps it: Apple shows its
//   card at most 3 times a year, and Google decides on its own when to show its card).
// - The phone's own rating card, no stars or questions of ours before it, and nothing more if they close it.
//   Apple and Google don't say if it showed or what was given.
// Kept in tf:rate on this device only (not synced): { days: [last 3 dates], first, moments, asks: [ms], ver }.
// Tests: ?rate=now asks at the next happy moment, skipping the days and version rules (the store's own limits still
// apply: TestFlight never shows Apple's card, a development build always does).
(() => {
  const C = window.Capacitor;
  window.tfHappy = () => {};
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  if (!(C.isPluginAvailable && C.isPluginAvailable("TrailReview"))) return;   // older app builds have no plugin yet
  const Review = C.registerPlugin ? C.registerPlugin("TrailReview") : (C.Plugins || {}).TrailReview;
  const App = C.registerPlugin ? C.registerPlugin("App") : (C.Plugins || {}).App;
  if (!Review) return;

  const KEY = "tf:rate", DAY = 864e5;
  const MIN_DAYS = 3, MIN_AGE = 7 * DAY, MIN_MOMENTS = 2, GAP = 120 * DAY, PER_YEAR = 3, ERR_QUIET = 5 * 60e3;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
  const today = () => new Date().toLocaleDateString("en-CA");
  const test = /[?&]rate=now\b/.test(location.search);

  // Count the days the app is opened (only the last few dates are kept).
  const st = load();
  if (!st.first) st.first = Date.now();
  st.days = Array.isArray(st.days) ? st.days : [];
  if (!st.days.includes(today())) st.days = [...st.days, today()].slice(-MIN_DAYS);
  save(st);

  // An error on the page this visit keeps it quiet for a while: never ask right after something went wrong.
  let lastErr = 0;
  addEventListener("error", () => { lastErr = Date.now(); });
  addEventListener("unhandledrejection", () => { lastErr = Date.now(); });

  let ver = "";
  if (App && App.getInfo) App.getInfo().then((i) => { ver = (i && (i.version + "." + i.build)) || ""; }).catch(() => {});

  let pending = 0;
  function ready(s) {
    const now = Date.now();
    if (now - lastErr < ERR_QUIET) return false;
    if (test) return true;
    if ((s.moments || 0) < MIN_MOMENTS) return false;
    if ((s.days || []).length < MIN_DAYS || now - (s.first || now) < MIN_AGE) return false;
    const asks = (s.asks || []).filter((t) => now - t < 365 * DAY);
    if (asks.length >= PER_YEAR || (asks.length && now - asks[asks.length - 1] < GAP)) return false;
    if (ver && s.ver === ver) return false;
    return true;
  }
  // Something else on screen right now (the Sign in card or the notifications card after a save, a ride being recorded, the welcome, a dialog):
  // wait for the next happy moment instead.
  const busy = () => document.hidden || !!document.querySelector(".acct-nudge, .nt-ask, .welc, dialog[open]")
    || (window.tfWelcome && window.tfWelcome.pending);

  window.tfHappy = (kind) => {
    const s = load();
    s.moments = (s.moments || 0) + 1;
    save(s);
    if (!ready(s) || pending) return;
    // A moment later, after the page's own "Saved" note, and after the Sign in card would have shown (2.2 s).
    pending = setTimeout(() => {
      pending = 0;
      const s2 = load();
      if (!ready(s2) || busy()) return;
      s2.asks = [...(s2.asks || []).filter((t) => Date.now() - t < 365 * DAY), Date.now()];
      if (ver) s2.ver = ver;
      save(s2);
      if (window.tfUse) window.tfUse("view", `Rating asked: ${String(kind || "").slice(0, 30)}`);
      Review.requestReview().catch(() => {});
    }, 3000);
  };
})();
