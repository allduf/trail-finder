// How people use Trail Finder, so alex can see what people really do and make the app more practical.
// The iPhone app, the Android app and the website (alex 2026-11-17: the website and Android too, the same way: on,
// with Don't share in More; until then only the iPhone app sent it). Sends, in batches: page opens, the sport,
// taps on buttons (their id, or a short button label), errors, how long each visit lasted, what is typed in the search
// boxes and Ask (and how many results came back), how long the page, map and 3D take to load, restarts after a
// crash, and the named area the map shows (a zone like "Whistler" or a province, never a point). Each phone is the
// random device code from visitors.js (tf:device): no name, email, location, photo or other typed text is sent.
// Read on usage.html by accounts listed in tf_admins. See supabase/usage.sql.
(() => {
  const C = window.Capacitor, acct = window.tfAccount;
  if (!acct || !acct.enabled) { window.tfUse = () => {}; window.tfUseQ = []; return; }
  // Tests send nothing (as visitors.js): test browsers on the live site (Playwright: navigator.webdriver), and the
  // Android app's own test on GitHub (android-app/test/phone-check.mjs), which opens the pull request's website from
  // the runner at http://10.0.2.2:8080 and restarts the app on purpose. Its restarts read as crashes and its slow
  // simulator as slow opens on the usage page (2026-11-19: 2 "crashes" and a 12 s "slow" that were only tests).
  // Also the side-by-side check (scripts/side-by-side/run.mjs, 2026-11-22): its iPhone simulator and Android emulator
  // open http://localhost:8080 and the app is closed and opened again on purpose, so every run sent "MTB · flat map"
  // crashes from a new device (25 that day, none a real person's). The real apps open https://trailfinderapp.ca.
  if (navigator.webdriver || (location.protocol === "http:" && /^(10\.0\.2\.2|localhost|127\.0\.0\.1)$/.test(location.hostname))) { window.tfUse = () => {}; window.tfUseQ = []; return; }
  // Where it runs: "ios", "android" or "web" (the website, phone or computer).
  const native = !!(C && C.isNativePlatform && C.isNativePlatform());
  const plat = native ? ((C.getPlatform && C.getPlatform()) || "ios") : "web";
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  // More → How the app is used: Don't share stops it at once and drops what wasn't sent yet (tf:useOff, this device).
  let off = lsGet("tf:useOff") === "1";
  window.tfUsage = {
    on: () => !off,
    set(v) {
      off = !v;
      try { if (off) { localStorage.setItem("tf:useOff", "1"); localStorage.removeItem("tf:useQueue"); queue = []; } else localStorage.removeItem("tf:useOff"); } catch {}
    },
  };
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

  let device = lsGet("tf:device");
  if (!device) { device = rid(); lsSet("tf:device", device); }
  // One visit carries on across index.html and ride.html; a new one starts after 30 min away.
  const SESSION_GAP = 30 * 60e3;
  let session = lsGet("tf:useSession");
  if (!session || Date.now() - Number(lsGet("tf:useSeen") || 0) > SESSION_GAP) session = rid().slice(0, 12);
  lsSet("tf:useSession", session);
  const seen = () => lsSet("tf:useSeen", String(Date.now()));
  seen();

  const page = (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "") || "index";
  // The iOS in the user agent is frozen (it reads 18.7 on iOS 26), so builds with the Device plugin send the real
  // version and the model code (e.g. "iOS 26.5 · iPhone17,1"): alex matches them to the TestFlight tester list.
  // The Android app sends "Android 15 · Pixel 8"; the website "Web · Safari on iPhone" (browser and system only).
  const ua = navigator.userAgent;
  const uaOs = ((ua.match(/OS (\d+[_\d]*) like Mac/) || [])[1] || "").replace(/_/g, ".");
  const webOs = () => {
    const sys = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad" : /Android/.test(ua) ? "Android"
      : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "other";
    const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
    return `Web · ${br} on ${sys}`;
  };
  const uaAndroid = (ua.match(/Android (\d+(?:\.\d+)*)/) || [])[1] || "";
  let os = plat === "web" ? webOs() : plat === "android" ? (uaAndroid ? `Android ${uaAndroid}` : "Android") : uaOs ? `iOS ${uaOs}` : "iOS";
  if (native) try {
    const Device = C.registerPlugin ? C.registerPlugin("Device") : (C.Plugins || {}).Device;
    const name = plat === "android" ? "Android" : "iOS";
    if (Device) Device.getInfo().then((i) => { if (i && i.osVersion) os = `${name} ${i.osVersion}${i.model ? ` · ${i.model}` : ""}`.slice(0, 40); }).catch(() => {});
  } catch {}
  const screenSize = `${Math.min(screen.width, screen.height)}x${Math.max(screen.width, screen.height)}`;

  // The app version (the shared ?v= tag), sent in the ms field of crashes and errors so the usage page can tell the
  // problems an update already fixed from the ones still happening (alex's Problems list, 2026-11-13). A crash is
  // seen when the app opens again, so it carries the version that was running before (tf:useVer), not the new one.
  const VER = Number(((document.currentScript && document.currentScript.src) || "").match(/[?&]v=(\d+)/)?.[1]) || null;
  const PREV_VER = Number(lsGet("tf:useVer")) || VER;
  if (VER) lsSet("tf:useVer", String(VER));

  const QKEY = "tf:useQueue", MAX_QUEUE = 400;
  let queue = [];
  try { queue = JSON.parse(lsGet(QKEY) || "[]"); } catch {}
  // Taps saved by an older copy of this script before it was sent (an Account tap kept the email): cleaned here too.
  const oldTap = (w) => String(w).replace(/^\S*@\S*/, "Account");
  // A web viewer too old for the map (no Object.hasOwn: Chrome before 93, Safari before 15.4) gets index.html's update
  // note; MapLibre's errors there ("Script error." with no detail: 195 rows of 16-23 Nov 2026, all from
  // Google Play's review phones) and its restarts can't be fixed in the app, so they aren't sent. Visits still are.
  // Nothing personal is ever sent, whatever the caller passes (alex 2026-11-27: the Account button's label was the
  // signed-in person's email): an email, a phone number or a map point in any event becomes a plain word. The same
  // rule runs on the server (supabase/usage-scrub.sql) for copies of this script still cached on phones. Error
  // messages keep their numbers (times, sizes, versions), only emails go. Long text is cut first, so this stays quick.
  const scrub = (t, all = true) => {
    t = String(t).slice(0, 400).replace(/[\w.%+#-]+@[\w#-]+(?:\.[\w#-]+)+/g, "[email]");
    return !all ? t : t.replace(/-?\d{1,3}\.\d{3,}\s*[,; ]\s*-?\d{1,3}\.\d{3,}/g, "[point]")
      .replace(/-?\b\d{1,3}\.\d{4,}\b/g, "[point]")
      .replace(/\+?\d(?:[\s().-]*\d){8,14}/g, "[phone]");
  };
  const oldViewer = typeof Object.hasOwn !== "function";
  queue = queue.map((e) => (e && e.w ? { ...e, w: scrub(e.k === "tap" ? oldTap(e.w) : e.w, e.k !== "error").slice(0, 120) } : e));
  const add = (k, w, ms) => {
    if (off) return;
    if (oldViewer && (k === "error" || k === "crash")) return;
    if (k === "crash") ms = PREV_VER; else if (k === "error") ms = VER;
    queue.push({ s: session, t: new Date().toISOString(), p: page, k, w: w == null ? null : scrub(w, k !== "error").slice(0, 120), ms });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    lsSet(QKEY, JSON.stringify(queue));
    seen();
  };

  // What the app itself reports (window.tfUse below): searches, results, picks, trail cards, load times, crashes, area.
  // A search is sent once the person stops typing (2.5 s), so "whis", "whistl", "whistler" count once; a pick in the
  // same box sends it at once. Typed GPS points are never sent, only "GPS point".
  const KINDS = new Set(["search", "result", "pick", "view", "speed", "crash", "area"]);
  const typing = new Map();   // box -> { q, n, timer }
  const boxOf = (w) => String(w).split(":")[0];
  const sendSearch = (box) => { const t = typing.get(box); if (!t) return; clearTimeout(t.timer); typing.delete(box); add("search", t.q, t.n); };
  let lastArea = null;
  window.tfUse = (kind, what, n) => {
    if (!KINDS.has(kind)) return;
    if (kind === "search") {
      const box = boxOf(what);
      let q = String(what).slice(box.length + 1).replace(/\s+/g, " ").trim();
      if (q.length < 2) return;
      if (/-?\d{1,3}[.,]\d+/.test(q)) q = "GPS point";
      // Ask gets one call per question once it's answered (ask.js), so it goes at once. In a box still being typed in,
      // a new search that isn't the same words typed on (or backed up) sends the one before it, so it isn't lost.
      if (box === "Ask") { sendSearch(box); add("search", `${box}: ${q.slice(0, 60)}`, n == null ? null : Math.max(0, Math.round(n))); return; }
      const t = typing.get(box) || {};
      const was = t.q ? t.q.slice(box.length + 2).toLowerCase() : "", now = `${q.slice(0, 60)}`.toLowerCase();
      if (was && !now.startsWith(was) && !was.startsWith(now)) sendSearch(box);
      clearTimeout(t.timer);
      typing.set(box, { q: `${box}: ${q.slice(0, 60)}`, n: n == null ? null : Math.max(0, Math.round(n)), timer: setTimeout(() => sendSearch(box), 2500) });
      return;
    }
    if (kind === "pick") sendSearch(boxOf(what));
    if (kind === "area") { if (!what || what === lastArea) return; lastArea = what; }
    add(kind, what, n == null ? null : Math.max(0, Math.round(n)));
  };
  (window.tfUseQ || []).forEach((a) => window.tfUse(...a));
  window.tfUseQ = [];

  let sending = false;
  function flush(leaving) {
    if (off || sending || !queue.length || !navigator.onLine) return;
    const batch = queue.slice(0, 200);
    sending = true;
    fetch(`${acct.url}/rest/v1/rpc/tf_use`, {
      method: "POST", keepalive: !!leaving,
      headers: { "Content-Type": "application/json", apikey: acct.key, Authorization: `Bearer ${acct.key}` },
      body: JSON.stringify({ device, os, screen: screenSize, events: batch }),
    }).then(async (res) => {
      // How the last send went (tf:useLast), shown on usage.html opened in this same browser, so a phone or browser
      // whose usage never arrives can be told apart from one that sent nothing (alex 2026-11-17).
      if (!res.ok) {
        const why = await res.text().catch(() => "");
        lsSet("tf:useLast", JSON.stringify({ t: Date.now(), ok: false, why: `${res.status} ${why}`.slice(0, 300), n: batch.length }));
        // A batch the server refuses (400: bad data) would be refused forever and hold back everything after it.
        if (res.status !== 400) return;
      } else lsSet("tf:useLast", JSON.stringify({ t: Date.now(), ok: true, n: batch.length }));
      queue = queue.slice(batch.length);
      lsSet(QKEY, JSON.stringify(queue));
    }).catch((e) => { lsSet("tf:useLast", JSON.stringify({ t: Date.now(), ok: false, why: String((e && e.message) || e).slice(0, 300), n: batch.length })); }).finally(() => { sending = false; });
  }
  setInterval(flush, 30e3);

  // What a tap was on: the element's id, a data-* choice (sport, hub, layer...), or a short button label.
  // Lists of trails, rides, saved places and search results are only counted as "list", never their names.
  const LISTS = "#list, #results, #trailHits, #wantList, #history, #keyList, [data-list], ul, ol, table";
  const DATA = ["sport", "hub", "tab", "layer", "mode", "act", "action", "view", "sheet"];
  // Places whose buttons show what people typed or who they are (the Account button, whose tooltip is the email; a
  // cabin or bike trip's names, costs, meals and notes; the friends list): only the place is sent, never the words.
  const PRIVATE = ".acct-btn, #acctWho, #tpGroup, #tpIam, #tpCost, #tpMeals, #tpJour, #tpPack, #tpPlan, #tpCatch, #tpPhotos, #tpBook, #tpCabin, #tpBikes, #tpDays, #tpStops, #skTrip, #mtTrips, #mtTripCard, .frd-who, [data-private]";
  // A button's own words, without the choices of a menu inside it (a "You are" label held every group member's name).
  const ownText = (el) => {
    let t = "";
    for (const n of el.childNodes || []) {
      if (n.nodeType === 3) t += n.nodeValue;
      else if (n.nodeType === 1 && !/^(SELECT|OPTION|TEXTAREA|INPUT)$/.test(n.tagName)) t += ` ${ownText(n)} `;
    }
    return t;
  };
  function tapName(el) {
    if (el.classList && el.classList.contains("acct-btn")) { const h = el.closest("[id]"); return `Account${h ? ` (in #${h.id})` : ""}`; }
    if (el.id) return `#${el.id}`;
    for (const d of DATA) if (el.dataset && el.dataset[d] != null) return `${d}=${String(el.dataset[d]).slice(0, 40)}`;
    if (el.closest(LISTS)) {
      const box = el.closest(LISTS);
      return `list:${box.id ? "#" + box.id : box.tagName.toLowerCase()}`;
    }
    const holder = el.closest("[id]");
    const where = holder ? ` (in #${holder.id})` : "";
    if (el.closest(PRIVATE)) return `item${where}`;
    const text = scrub(el.getAttribute("aria-label") || el.title || (el.querySelector && el.querySelector("select, textarea, input") ? ownText(el) : el.innerText || el.textContent) || "").replace(/\s+/g, " ").replace(/\d+/g, "#").trim();
    if (!text) return null;
    return `${text.slice(0, 40)}${where}`;
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest("button, a, [role=button], [role=tab], summary, input[type=checkbox], input[type=radio], label");
    if (!el) return;
    const name = tapName(el);
    if (name) add("tap", name);
  }, true);

  const sport = document.getElementById("sport");
  if (sport) sport.addEventListener("change", () => add("sport", sport.value));

  // A route that still doubles back somewhere (noback.js): in the error list, to be fixed.
  addEventListener("tf:route-back", (e) => add("error", (e.detail && e.detail.msg) || "Route doubles back"));
  addEventListener("error", (e) => add("error", `${e.message || "error"} @${(e.filename || "").split("/").pop()}:${e.lineno || 0}`));
  // A cancelled download (AbortError, "Fetch is aborted") is the app stopping work it no longer needs, not a fault.
  addEventListener("unhandledrejection", (e) => {
    if (e.reason && e.reason.name === "AbortError") return;
    // Where it came from (the first file and line in the stack): "promise: HTTP 404" alone couldn't be traced (2026-11-10).
    const m = String((e.reason && e.reason.stack) || "").match(/[a-z]+:\/\/[^\s()]*?\/([\w.-]*)(?:[?#][^\s()]*?)?:(\d+):\d+/);
    const at = m ? `${m[1] || "index"}:${m[2]}` : "";
    add("error", `promise: ${(e.reason && (e.reason.message || e.reason)) || "rejected"}${at ? ` @${at}` : ""}`);
  });

  // Crash restarts: "tf:useAlive" is renewed every few seconds while the app is on screen and cleared when it is hidden
  // or left normally (also going to ride.html). If the page opens on screen less than a minute after it, the app died
  // and iOS reloaded it. map3d.js reports the same thing as "3d" when it happened in the 3D map.
  // "tf:useCtx" keeps where the app was (sport, flat or 3D map, the open tab), sent with the crash so the usage page
  // can say more than "Somewhere else" (alex 2026-11-02).
  const ALIVE = "tf:useAlive", CTX = "tf:useCtx";
  let afterOut = 0;
  try { if (sessionStorage.getItem("tf:signedOut")) afterOut = Date.now(); } catch {}
  { const t = Number(lsGet(ALIVE) || 0); if (t && Date.now() - t < 60e3 && document.visibilityState === "visible") { const c = lsGet(CTX); add("crash", c ? `app · ${c}` : "app"); } }
  // The flat map within 15 s of leaving 3D says so, and the place is saved at once when 3D goes on or off: it was
  // saved every 5 s only, so a crash just after leaving 3D read "Not in 3D · 3D map" (alex 2026-11-16).
  const where = () => {
    const b = document.body.classList, sp = ["mtb", "ski", "hunt", "fish", "moto", "hike"].find((x) => b.contains("sport-" + x));
    const tab = document.querySelector("#tabbar [aria-current=true]");
    // Native 3D (the phone's own, native-map.js) has no .is3d on the page: said apart, as is a page just after Sign out.
    const m = window.tfNative && window.tfNative.isOpen && window.tfNative.isOpen() ? "native 3D" : document.querySelector(".is3d") ? "3D map" : Date.now() - (window.tf3dLeftAt || 0) < 15e3 ? "flat map just after 3D" : "flat map";
    return [sp, m, tab ? `${(tab.textContent || "").trim().slice(0, 12)} tab` : "", afterOut && Date.now() - afterOut < 30e3 ? "after Sign out" : ""].filter(Boolean).join(" · ");
  };
  const alive = (v) => { try { if (v) { localStorage.setItem(ALIVE, String(Date.now())); localStorage.setItem(CTX, where()); } else localStorage.removeItem(ALIVE); } catch {} };
  addEventListener("tf:3d", () => { if (document.visibilityState === "visible") alive(true); });
  setInterval(() => { if (document.visibilityState === "visible") alive(true); }, 5000);
  alive(true);
  // How long the page took to be ready, from the start of loading.
  // Also where that time went (alex's Speed card, 2026-10-29: 4.5 s): the page itself arriving, then its scripts running.
  const timePage = () => {
    add("speed", "page", Math.round(performance.now()));
    const n = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (n && n.responseEnd > 0) add("speed", "html", Math.round(n.responseEnd));
    // Where the page's own wait went: the saved-copy helper (sw.js) starting, then the page's first bytes (the iPhone
    // app's page took 3-4 s on alex's phone, 2026-11-21, with scripts only ~0.4 s after it).
    if (n && n.workerStart > 0) add("speed", "sw", Math.round(n.workerStart));
    if (n && n.responseStart > 0) add("speed", "first", Math.round(n.responseStart));
    if (n && n.domContentLoadedEventEnd > 0) add("speed", "dcl", Math.round(n.domContentLoadedEventEnd));
  };
  if (document.readyState === "complete") timePage(); else addEventListener("load", timePage);

  // A visit's length counts only time on screen.
  let shownAt = Date.now();
  const opened = () => { shownAt = Date.now(); add("open", sport ? sport.value : null); flush(); };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { typing.forEach((_, b) => sendSearch(b)); alive(false); add("end", null, Date.now() - shownAt); flush(true); }
    else {
      if (Date.now() - Number(lsGet("tf:useSeen") || 0) > SESSION_GAP) { session = rid().slice(0, 12); lsSet("tf:useSession", session); }
      alive(true); opened();
    }
  });
  addEventListener("pagehide", () => { typing.forEach((_, b) => sendSearch(b)); alive(false); if (document.visibilityState !== "hidden") { add("end", null, Date.now() - shownAt); flush(true); } });
  if (document.readyState === "complete") opened(); else addEventListener("load", opened);
})();
