// Offline maps in the iPhone's native 3D map (alex 2026-11-20: every web feature in native 3D, and "i want everything
// to work smoothly when im not connected"). The page side of NativeOffline.swift (ios-app/plugins/TrailMap):
//   - what native 3D draws: whether there's signal, and the saved areas with their "✓ Saved: name" words, so with no
//     signal it shows the saved map and the green dashed squares, as the web 3D map does (offline.js);
//   - the iPhone's own copy of each area saved with "3D map too": the page's saved files are out of reach of the
//     native map, so it keeps its own (the same map, heights and Winter photos). It starts after the web save is done,
//     follows Try again and Delete, and carries on by itself with signal. Only on alex's devices for now (tf-admin,
//     like native 3D itself), and its line in the Offline maps list says how it's going.
// On the website and app builds without the TrailMap plugin, this file does nothing; nor in an Android build without its
// own offline copies yet (tfNative.draws("offline")).
(() => {
  "use strict";
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  if (C.isPluginAvailable && !C.isPluginAvailable("TrailMap")) return;
  const TrailMap = C.registerPlugin ? C.registerPlugin("TrailMap") : (C.Plugins || {}).TrailMap;
  if (!TrailMap) return;
  const t = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);
  const load = () => { try { return JSON.parse(localStorage.getItem("tf-offline-areas")) || []; } catch { return []; } };
  // alex's devices, or every iPhone whose app build has native 3D for everything (native-map.js tfNative.full).
  const admin = () => { try { if (window.tfNative && window.tfNative.full && window.tfNative.full()) return true; return localStorage.getItem("tf-admin") === "1"; } catch { return false; } };

  // ---------- what native 3D draws ----------
  const drawData = () => JSON.stringify({
    online: navigator.onLine,
    noSignal: t("No signal: the saved map"),
    areas: load().map((a) => ({ box: a.box, label: `${a.missing ? "\u26A0\uFE0E" : "✓"} ${t("Saved")}: ${a.name}` })),
  });
  const N = () => window.tfNative;
  if (N() && N().addLayer) N().addLayer("offline", drawData);
  const redraw = () => { if (N() && N().send) N().send("offline"); };
  window.addEventListener("online", redraw);
  window.addEventListener("offline", redraw);
  window.addEventListener("tf:offline", redraw);

  // ---------- the iPhone's own copy ----------
  let packs = {}, timer = 0;
  const sync = () => {
    if (!admin() || !TrailMap.offline) return;
    if (N() && N().draws && !N().draws("offline")) return;   // Android: no native offline copies yet
    const areas = load().filter((a) => a.d3).map((a) => ({ id: a.id, box: a.box, ...(a.boxes ? { boxes: a.boxes } : {}), ski: (a.sport || (a.ski ? "ski" : "mtb")) === "ski", sharp: +(a.dz0 || a.dz) >= 15 }));   // dz0: the detail first saved: a later "Full detail" doesn't make the iPhone fetch its whole copy again
    TrailMap.offline({ areas }).then((r) => { packs = (r && r.areas) || {}; paint(); }).catch(() => {});
  };
  const later = (ms) => { clearTimeout(timer); timer = setTimeout(sync, ms); };
  if (TrailMap.addListener) TrailMap.addListener("offlinePacks", (r) => { packs = (r && r.areas) || {}; paint(); });
  // A save done (saved or missing some files) or an area deleted: the copy follows. Not while a save runs.
  window.addEventListener("tf:offline", (e) => { if (!e.detail || e.detail.state !== "saving") later(2000); });
  window.addEventListener("online", () => later(5000));
  window.addEventListener("tf:admin", () => later(2000));
  later(30000);   // once the app has settled, so opening it stays as quick as before

  // Its line under each area in Offline maps (offline.js redraws the list; this adds to each row).
  const fr = () => !!(window.tfLang && window.tfLang.lang === "fr");
  const mb = (b) => (b < 1e6 ? t("under 1 MB") : b < 1e9 ? Math.round(b / 1e6) + (fr() ? " Mo" : " MB") : (b / 1e9).toFixed(1).replace(".", fr() ? "," : ".") + (fr() ? " Go" : " GB"));
  // The phone's own word: this line shows in the Android app too (its native 3D keeps the same copies).
  const android = !!(C.getPlatform && C.getPlatform() === "android");
  function line(p) {
    if (!p) return "";
    if (android) {
      if (p.saved) return "✓ " + t("Phone 3D copy saved") + ` (${mb(p.bytes || 0)})`;
      if (!navigator.onLine) return t("Phone 3D copy: not finished, it carries on with signal");
      return t("Phone 3D copy: saving") + ` ${p.pct || 0}%`;
    }
    if (p.saved) return "✓ " + t("iPhone 3D copy saved") + ` (${mb(p.bytes || 0)})`;
    if (!navigator.onLine) return t("iPhone 3D copy: not finished, it carries on with signal");
    return t("iPhone 3D copy: saving") + ` ${p.pct || 0}%`;
  }
  function paint() {
    const list = document.querySelector(".offline-card [data-list]");
    if (!list || !admin()) return;
    for (const li of list.children) {
      const id = (li.querySelector("[data-show]") || {}).dataset;
      const p = id && packs[id.show], div = li.querySelector("div");
      if (!div) continue;
      let el = div.querySelector("[data-n3d]");
      const text = line(p);
      if (!text) { if (el) el.remove(); continue; }
      if (!el) { el = document.createElement("span"); el.className = "muted"; el.dataset.n3d = ""; el.style.display = "block"; div.append(el); }
      if (el.textContent !== text) el.textContent = text;
    }
  }
  const watch = () => {
    const list = document.querySelector(".offline-card [data-list]");
    if (!list) return false;
    new MutationObserver(paint).observe(list, { childList: true });
    return true;
  };
  if (!watch()) setTimeout(watch, 3000);
})();
