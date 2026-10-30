// How testers use the iPhone app, so alex can see what people really do and make the app more practical.
// Inside the app only (Capacitor); on the website this file does nothing. Sends, in batches: page opens, the sport,
// taps on buttons (their id, or a short button label), errors, how long each visit lasted, what is typed in the search
// boxes and Ask (and how many results came back), how long the page, map and 3D take to load, restarts after a
// crash, and the named area the map shows (a zone like "Whistler" or a province, never a point). Each phone is the
// random device code from visitors.js (tf:device): no name, email, location, photo or other typed text is sent.
// Read on usage.html by accounts listed in tf_admins. See supabase/usage.sql.
(() => {
  const C = window.Capacitor, acct = window.tfAccount;
  if (!C || !C.isNativePlatform || !C.isNativePlatform() || !acct || !acct.enabled) { window.tfUse = () => {}; window.tfUseQ = []; return; }
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
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
  const uaOs = ((navigator.userAgent.match(/OS (\d+[_\d]*) like Mac/) || [])[1] || "").replace(/_/g, ".");
  let os = uaOs ? `iOS ${uaOs}` : "iOS";
  try {
    const Device = C.registerPlugin ? C.registerPlugin("Device") : (C.Plugins || {}).Device;
    if (Device) Device.getInfo().then((i) => { if (i && i.osVersion) os = `iOS ${i.osVersion}${i.model ? ` · ${i.model}` : ""}`; }).catch(() => {});
  } catch {}
  const screenSize = `${Math.min(screen.width, screen.height)}x${Math.max(screen.width, screen.height)}`;

  const QKEY = "tf:useQueue", MAX_QUEUE = 400;
  let queue = [];
  try { queue = JSON.parse(lsGet(QKEY) || "[]"); } catch {}
  const add = (k, w, ms) => {
    queue.push({ s: session, t: new Date().toISOString(), p: page, k, w: w == null ? null : String(w).slice(0, 120), ms });
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
      const t = typing.get(box) || {};
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
    if (sending || !queue.length || !navigator.onLine) return;
    const batch = queue.slice(0, 200);
    sending = true;
    fetch(`${acct.url}/rest/v1/rpc/tf_use`, {
      method: "POST", keepalive: !!leaving,
      headers: { "Content-Type": "application/json", apikey: acct.key, Authorization: `Bearer ${acct.key}` },
      body: JSON.stringify({ device, os, screen: screenSize, events: batch }),
    }).then((res) => {
      if (!res.ok) return;
      queue = queue.slice(batch.length);
      lsSet(QKEY, JSON.stringify(queue));
    }).catch(() => {}).finally(() => { sending = false; });
  }
  setInterval(flush, 30e3);

  // What a tap was on: the element's id, a data-* choice (sport, hub, layer...), or a short button label.
  // Lists of trails, rides, saved places and search results are only counted as "list", never their names.
  const LISTS = "#list, #results, #trailHits, #wantList, #history, #keyList, [data-list], ul, ol, table";
  const DATA = ["sport", "hub", "tab", "layer", "mode", "act", "action", "view", "sheet"];
  function tapName(el) {
    if (el.id) return `#${el.id}`;
    for (const d of DATA) if (el.dataset && el.dataset[d] != null) return `${d}=${String(el.dataset[d]).slice(0, 40)}`;
    if (el.closest(LISTS)) {
      const box = el.closest(LISTS);
      return `list:${box.id ? "#" + box.id : box.tagName.toLowerCase()}`;
    }
    const text = (el.getAttribute("aria-label") || el.title || el.innerText || el.textContent || "").replace(/\s+/g, " ").replace(/\d+/g, "#").trim();
    if (!text) return null;
    const holder = el.closest("[id]");
    return `${text.slice(0, 40)}${holder ? ` (in #${holder.id})` : ""}`;
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest("button, a, [role=button], [role=tab], summary, input[type=checkbox], input[type=radio], label");
    if (!el) return;
    const name = tapName(el);
    if (name) add("tap", name);
  }, true);

  const sport = document.getElementById("sport");
  if (sport) sport.addEventListener("change", () => add("sport", sport.value));

  addEventListener("error", (e) => add("error", `${e.message || "error"} @${(e.filename || "").split("/").pop()}:${e.lineno || 0}`));
  // A cancelled download (AbortError, "Fetch is aborted") is the app stopping work it no longer needs, not a fault.
  addEventListener("unhandledrejection", (e) => {
    if (e.reason && e.reason.name === "AbortError") return;
    add("error", `promise: ${(e.reason && (e.reason.message || e.reason)) || "rejected"}`);
  });

  // Crash restarts: "tf:useAlive" is renewed every few seconds while the app is on screen and cleared when it is hidden
  // or left normally (also going to ride.html). If the page opens on screen less than a minute after it, the app died
  // and iOS reloaded it. map3d.js reports the same thing as "3d" when it happened in the 3D map.
  const ALIVE = "tf:useAlive";
  { const t = Number(lsGet(ALIVE) || 0); if (t && Date.now() - t < 60e3 && document.visibilityState === "visible") add("crash", "app"); }
  const alive = (v) => { try { v ? localStorage.setItem(ALIVE, String(Date.now())) : localStorage.removeItem(ALIVE); } catch {} };
  setInterval(() => { if (document.visibilityState === "visible") alive(true); }, 5000);
  alive(true);
  // How long the page took to be ready, from the start of loading.
  // Also where that time went (alex's Speed card, 2026-10-29: 4.5 s): the page itself arriving, then its scripts running.
  const timePage = () => {
    add("speed", "page", Math.round(performance.now()));
    const n = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (n && n.responseEnd > 0) add("speed", "html", Math.round(n.responseEnd));
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
