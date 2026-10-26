// How testers use the iPhone app, so alex can see what people really do and make the app more practical.
// Inside the app only (Capacitor); on the website this file does nothing. Sends, in batches: page opens, the sport,
// taps on buttons (their id, or a short button label), errors, and how long each visit lasted. Each phone is the
// random device code from visitors.js (tf:device): no name, email, location, typed text or photo is sent.
// Read on usage.html by accounts listed in tf_admins. See supabase/usage.sql.
(() => {
  const C = window.Capacitor, acct = window.tfAccount;
  if (!C || !C.isNativePlatform || !C.isNativePlatform() || !acct || !acct.enabled) return;
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
  const os = ((navigator.userAgent.match(/OS (\d+[_\d]*) like Mac/) || [])[1] || "").replace(/_/g, ".");
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

  let sending = false;
  function flush(leaving) {
    if (sending || !queue.length || !navigator.onLine) return;
    const batch = queue.slice(0, 200);
    sending = true;
    fetch(`${acct.url}/rest/v1/rpc/tf_use`, {
      method: "POST", keepalive: !!leaving,
      headers: { "Content-Type": "application/json", apikey: acct.key, Authorization: `Bearer ${acct.key}` },
      body: JSON.stringify({ device, os: os ? `iOS ${os}` : "iOS", screen: screenSize, events: batch }),
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
    const text = (el.getAttribute("aria-label") || el.title || el.textContent || "").replace(/\s+/g, " ").replace(/\d+/g, "#").trim();
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
  addEventListener("unhandledrejection", (e) => add("error", `promise: ${(e.reason && (e.reason.message || e.reason)) || "rejected"}`));

  // A visit's length counts only time on screen.
  let shownAt = Date.now();
  const opened = () => { shownAt = Date.now(); add("open", sport ? sport.value : null); flush(); };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { add("end", null, Date.now() - shownAt); flush(true); }
    else {
      if (Date.now() - Number(lsGet("tf:useSeen") || 0) > SESSION_GAP) { session = rid().slice(0, 12); lsSet("tf:useSession", session); }
      opened();
    }
  });
  addEventListener("pagehide", () => { if (document.visibilityState !== "hidden") { add("end", null, Date.now() - shownAt); flush(true); } });
  if (document.readyState === "complete") opened(); else addEventListener("load", opened);
})();
