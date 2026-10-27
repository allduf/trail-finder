// New iPhone app build (alex, 2026-10-27: "add a popup every time there is a newer build available for them and tell
// them to update it in TestFlight"). Inside the iPhone app only; on the website this file does nothing.
//  - data/app-build.json { build } is the newest build alex has added to the Friends group in TestFlight. Change it
//    only after that, so testers aren't sent to TestFlight for a build they can't install yet.
//  - The installed build comes from the App plugin (CFBundleVersion = the ios-app.yml run number). Builds up to 24
//    don't have that plugin: with the Device plugin it's 17-24 (counted as 24), without it 16 or older.
//  - The card shows once per new build (tf:appUpdateSeen = that build); "Open TestFlight" opens the TestFlight app,
//    where the Update button is. It waits for What's new and any other popup or ride to be off the screen.
(() => {
  "use strict";
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  const KEY = "tf:appUpdateSeen", WAIT_MS = 4500, AGAIN_MS = 3600e3;
  const has = (name) => (C.isPluginAvailable ? C.isPluginAvailable(name) : !!(C.Plugins || {})[name]);
  const plugin = (name) => (C.registerPlugin ? C.registerPlugin(name) : (C.Plugins || {})[name]);

  const installed = () => has("App")
    ? plugin("App").getInfo().then((i) => parseInt(i && i.build, 10) || 0).catch(() => 0)
    : Promise.resolve(has("Device") ? 24 : 16);
  const latest = () => fetch("data/app-build.json", { cache: "no-cache" }).then((r) => r.json()).then((d) => parseInt(d && d.build, 10) || 0).catch(() => 0);
  const seen = () => { try { return parseInt(localStorage.getItem(KEY), 10) || 0; } catch { return 0; } };

  const css = document.createElement("style");
  css.textContent = `
dialog.appupd { border: 1px solid var(--line); border-radius: 16px; background: var(--panel); color: var(--fg); padding: 18px 16px 14px; width: min(380px, calc(100vw - 32px)); box-sizing: border-box; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; text-align: center; }
dialog.appupd::backdrop { background: rgba(0,0,0,.4); }
dialog.appupd .au-icon { font-size: 2rem; line-height: 1; }
dialog.appupd h2 { margin: 8px 0 6px; font-family: var(--font-display); font-size: 1.25rem; }
dialog.appupd p { margin: 0 0 4px; font-size: .95rem; line-height: 1.35; }
dialog.appupd p.au-how { color: var(--muted); font-size: .85rem; }
dialog.appupd button { display: block; width: 100%; font: inherit; font-weight: 700; padding: 12px; border-radius: 12px; cursor: pointer; }
dialog.appupd .au-go { margin-top: 14px; border: 0; background: var(--cta); color: var(--cta-fg); }
dialog.appupd .au-later { margin-top: 8px; border: 1px solid var(--line); background: transparent; color: var(--fg); font-weight: 600; }`;
  document.head.append(css);

  function show(build) {
    const dlg = document.createElement("dialog");
    dlg.className = "appupd";
    dlg.innerHTML = `<div class="au-icon" aria-hidden="true">⬆️</div><h2>New version of the app</h2>
      <p>Build ${build} is ready for you in TestFlight.</p>
      <p class="au-how">Open TestFlight, then tap Update next to Trail Finder.</p>
      <button type="button" class="au-go">Open TestFlight</button><button type="button" class="au-later">Later</button>`;
    dlg.querySelector(".au-go").addEventListener("click", () => { dlg.close(); location.href = "itms-beta://"; });
    dlg.querySelector(".au-later").addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector(".au-go").blur();
  }

  const busy = () => document.hidden || document.querySelector("dialog[open]") || (document.getElementById("about") && !document.getElementById("about").hidden) || document.querySelector(".riding");
  let lastCheck = 0;
  function check(tries = 8) {
    lastCheck = Date.now();
    Promise.all([installed(), latest()]).then(([have, newest]) => {
      if (!have || !newest || have >= newest || seen() >= newest) return;
      if (busy()) { if (tries > 0) setTimeout(() => check(tries - 1), 5000); return; }
      try { localStorage.setItem(KEY, String(newest)); } catch {}
      show(newest);
    });
  }
  const start = () => setTimeout(() => check(), WAIT_MS);
  if (document.readyState === "complete") start(); else addEventListener("load", start, { once: true });
  // The app often stays open in the background for days: look again when it comes back after a while.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - lastCheck > AGAIN_MS) setTimeout(() => check(), 1500); });
  window.tfAppUpdate = { check: () => check() };
})();
