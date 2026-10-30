// New iPhone app build (alex, 2026-10-27: "add a popup every time there is a newer build available for them and tell
// them to update it in TestFlight"). Inside the iPhone app only; on the website this file does nothing.
//  - data/app-build.json is written every hour by scripts/app-build.mjs (app-build.yml) from App Store Connect:
//    { build } = newest build the Friends group can install, { newest } = newest for internal testers (alex), who
//    get each build before Friends. Nobody edits it by hand any more (it sat on 32 while 36 was out, 2026-10-30).
//  - A phone that ever ran a build newer than Friends' is an internal tester's (tf:appInternal): it's told about
//    { newest }, everyone else about { build }. So is alex's when signed in (tf_is_admin, supabase/usage.sql), so alex
//    hears about a build before having tried one ahead of Friends.
//  - The installed build comes from the App plugin (CFBundleVersion = the ios-app.yml run number). Builds up to 24
//    don't have that plugin: with the Device plugin it's 17-24 (counted as 24), without it 16 or older.
//  - The card shows once per new build, and again a day after "Later" while the phone is still behind
//    (tf:appUpdateSeen = "build:time"); "Open TestFlight" opens the TestFlight app, where the Update button is.
//    It waits for What's new and any other popup or ride to be off the screen.
(() => {
  "use strict";
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  const KEY = "tf:appUpdateSeen", INTERNAL = "tf:appInternal", WAIT_MS = 4500, AGAIN_MS = 3600e3, REMIND_MS = 24 * 3600e3;
  const has = (name) => (C.isPluginAvailable ? C.isPluginAvailable(name) : !!(C.Plugins || {})[name]);
  const plugin = (name) => (C.registerPlugin ? C.registerPlugin(name) : (C.Plugins || {})[name]);

  const installed = () => has("App")
    ? plugin("App").getInfo().then((i) => parseInt(i && i.build, 10) || 0).catch(() => 0)
    : Promise.resolve(has("Device") ? 24 : 16);
  const num = (v) => parseInt(v, 10) || 0;
  const latest = () => fetch("data/app-build.json", { cache: "no-cache" }).then((r) => r.json())
    .then((d) => ({ build: num(d && d.build), newest: Math.max(num(d && d.build), num(d && d.newest)) })).catch(() => ({ build: 0, newest: 0 }));
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
  const admin = () => {
    const a = window.tfAccount;
    if (store(INTERNAL) || !a || !a.user || !a.client) return Promise.resolve();
    return a.client.rpc("tf_is_admin").then(({ data }) => { if (data === true) store(INTERNAL, "1"); }, () => {});
  };
  // "build:time" of the last card; an older plain "build" counts as shown long ago.
  const seen = () => { const [b, at] = String(store(KEY) || "").split(":"); return { b: num(b), at: num(at) }; };

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
    Promise.all([installed(), latest(), admin()]).then(([have, { build, newest }]) => {
      if (!have || !build) return;
      if (have > build) store(INTERNAL, "1");
      const target = store(INTERNAL) ? newest : build, last = seen();
      if (have >= target || (last.b >= target && Date.now() - last.at < REMIND_MS)) return;
      if (busy()) { if (tries > 0) setTimeout(() => check(tries - 1), 5000); return; }
      store(KEY, `${target}:${Date.now()}`);
      show(target);
    });
  }
  const start = () => setTimeout(() => check(), WAIT_MS);
  if (document.readyState === "complete") start(); else addEventListener("load", start, { once: true });
  // The app often stays open in the background for days: look again when it comes back after a while.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - lastCheck > AGAIN_MS) setTimeout(() => check(), 1500); });
  window.tfAppUpdate = { check: () => check() };
})();
