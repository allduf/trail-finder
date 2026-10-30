// Inside the iPhone app (ios-app/, Capacitor) only: makes the website behave like a native app. On the website this
// file does nothing. The app opens the live site, and Capacitor adds window.Capacitor with the native plugins
// listed in ios-app/package.json, so the site keeps one code path and these swaps happen here:
// - no page zoom, no text selection or long-press callouts outside text boxes, no grey tap flash
// - navigator.share -> the iPhone share sheet (Share plugin)
// - navigator.wakeLock -> KeepAwake plugin (WKWebView has no screen wake lock), used by ride.html and navigate.js
// - small vibrations on record start/stop and on Save buttons (Haptics plugin); window.tfHaptic(style) for others
// - the launch screen stays until the page has drawn (SplashScreen plugin)
(function () {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  const plugin = (name) => (C.registerPlugin ? C.registerPlugin(name) : (C.Plugins || {})[name]);
  const Share = plugin("Share"), Haptics = plugin("Haptics"), KeepAwake = plugin("KeepAwake"), Splash = plugin("SplashScreen");

  document.documentElement.classList.add("in-app");
  const css = document.createElement("style");
  css.textContent = `
    html.in-app, html.in-app body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
    html.in-app input, html.in-app textarea, html.in-app select, html.in-app [contenteditable] { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }`;
  document.head.appendChild(css);
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp && !/maximum-scale/.test(vp.content)) vp.content += ", maximum-scale=1, user-scalable=no";

  // Share sheet. Pictures (ski points) still go through the web share, which can carry files.
  const webShare = navigator.share && navigator.share.bind(navigator);
  navigator.share = async (data = {}) => {
    if (data.files && data.files.length && webShare) return webShare(data);
    try { await Share.share({ title: data.title, text: data.text, url: data.url, dialogTitle: data.title }); }
    catch (e) { if (!/cancel/i.test(String(e && e.message))) throw e; throw new DOMException("Share canceled", "AbortError"); }
  };

  // Screen wake lock with the same shape as the web one: request("screen") gives a sentinel with release().
  const held = new Set();
  const wakeLock = {
    async request() {
      await KeepAwake.keepAwake();
      const listeners = [];
      const s = {
        released: false, type: "screen",
        addEventListener(t, f) { if (t === "release") listeners.push(f); },
        removeEventListener() {},
        async release() {
          if (s.released) return;
          s.released = true; held.delete(s);
          if (!held.size) await KeepAwake.allowSleep().catch(() => {});
          listeners.forEach((f) => { try { f(); } catch {} });
        },
      };
      held.add(s);
      return s;
    },
  };
  try { Object.defineProperty(navigator, "wakeLock", { value: wakeLock, configurable: true }); } catch {}

  window.tfHaptic = (style = "LIGHT") => { try { Haptics.impact({ style }); } catch {} };
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.matches("button.rec, [data-haptic]")) window.tfHaptic("MEDIUM");
    else if (/^\s*(save|☆|★|✓ ridden|\+ ridden|enregistrer|✓ roulé|\+ roulé)/i.test(b.textContent || "")) window.tfHaptic("LIGHT");
  }, true);

  const hide = () => { try { Splash.hide({ fadeOutDuration: 200 }); } catch {} };
  if (document.readyState === "complete") hide(); else addEventListener("load", hide);
})();
