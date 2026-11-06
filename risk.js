// Your trip, your decisions (alex 2026-11-04: "we need to be clear that we are in no circumstance responsible for the
// decision the user made ... accident and everything"). Before the first route or tour a person asks for in each kind
// of planning, a sheet says plainly that the app is a planning aid, they decide and take all the risk, and Trail Finder
// isn't responsible; they tap I understand and accept (kept on this device per kind, asked again when its ACK version goes up
// with the terms). tfRiskLine() is the one short line under every planned route that says the same with a Terms link.
// The wording follows terms.html, whose full version still waits on a lawyer's review (see the terms draft doc).
// RULE (alex 2026-11-05): "Keep it updated everytime we add something": a new feature that suggests where to go or
// says how safe something is gets a line in terms.html (EN + FR) and, if it plans a route, a tfRiskOk kind here.
// Before anything else, every device agrees once to the terms (tfTerms below, "Before you head out"): asked again only
// when TERMS_V goes up after a real change to the terms (terms.html Changes promises a new I agree for a change that matters).
(function () {
  "use strict";
  var KEY = "tf:riskOk";
  // Each kind's version: raise one to ask again for that kind after its words change (avy 2: 2026-11-05, 3: renamed Less exposed way 2026-11-06).
  var ACK = { avy: 3, offtrail: 1, route: 1 };
  var KIND = {
    avy: "The Less exposed way, avalanche danger, ATES terrain classes (official or our estimate), slope angles, the weather it weighs, route and lift status and other people's GPS tracks are estimates from terrain models, forecasts and other people's data. They can be late or wrong, they can't see today's snowpack, cornices or wind loading, and a line the app picks can still slide.",
    offtrail: "Off-trail routes follow a terrain model and map data. They can cross private land, cliffs, high water, wildlife and closed areas the map doesn't know about.",
    route: "Routes can use trails and roads that are closed, private, unofficial, washed out or beyond your skills.",
  };
  function saved() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  // The avalanche sheet comes back once each winter (season = the year the winter starts, from August), so it's read
  // fresh before every season of touring (Safest way liability review 2026-11-06).
  var SEASONAL = { avy: true };
  function seasonNow() { var d = new Date(); return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1; }
  function accepted(kind) {
    var s = saved()[kind];
    return !!(s && s.v >= (ACK[kind] || 1) && (!SEASONAL[kind] || s.season === seasonNow()));
  }
  function remember(kind) {
    var s = saved(); s[kind] = { v: ACK[kind] || 1, at: new Date().toISOString() };
    if (SEASONAL[kind]) s[kind].season = seasonNow();
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    record(kind, s[kind].v, s[kind].season || 0, s[kind].at);
  }

  // Proof of each I agree, kept on the server too (supabase/agreements.sql): a phone can be lost or wiped, and a release
  // nobody can show was agreed to protects no one. Queued on the device (tf:agreeQ) until the server has it; agreements
  // made before this existed are sent once with their own date (tf:agreeSent).
  var QKEY = "tf:agreeQ", SENT = "tf:agreeSent";
  function lsJson(k, d) { try { return JSON.parse(localStorage.getItem(k) || "null") || d; } catch (e) { return d; } }
  function lsPut(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function record(what, v, season, at) {
    var sent = lsJson(SENT, {}), id = what + ":" + v + ":" + (season || 0);
    if (sent[id]) return;
    var q = lsJson(QKEY, []);
    if (!q.some(function (x) { return x.id === id; })) q.push({ id: id, what: what, v: v, season: season || 0, at: at || new Date().toISOString() });
    lsPut(QKEY, q.slice(-20));
    setTimeout(flush, 500);
  }
  var flushing = false;
  function flush() {
    var acct = window.tfAccount, q = lsJson(QKEY, []);
    if (flushing || !q.length || !acct || !acct.enabled || !acct.url || navigator.onLine === false) return;
    if (/[?&]nowelcome\b/.test(location.search) || navigator.webdriver) return;   // tests don't leave records
    var device = null;
    try { device = localStorage.getItem("tf:device"); if (!device) { device = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem("tf:device", device); } } catch (e) {}
    if (!device) return;
    flushing = true;
    var tokenP = Promise.resolve(null);
    try { if (acct.client && acct.client.auth) tokenP = acct.client.auth.getSession().then(function (r) { return r && r.data && r.data.session ? r.data.session.access_token : null; }).catch(function () { return null; }); } catch (e) {}
    tokenP.then(function (token) {
      var lang = (document.documentElement.lang || "en").slice(0, 10);
      return q.reduce(function (p, x) {
        return p.then(function () {
          return fetch(acct.url + "/rest/v1/rpc/tf_agree", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: acct.key, Authorization: "Bearer " + (token || acct.key) },
            body: JSON.stringify({ device: device, what: x.what, v: x.v, season: x.season, agreed_at: x.at, lang: lang }),
          }).then(function (res) {
            if (!res.ok) return;
            var sent = lsJson(SENT, {}); sent[x.id] = 1; lsPut(SENT, sent);
            lsPut(QKEY, lsJson(QKEY, []).filter(function (y) { return y.id !== x.id; }));
          });
        });
      }, Promise.resolve());
    }).catch(function () {}).then(function () { flushing = false; });
  }
  function backfill() {
    var t = lsJson(TKEY_EARLY, null);
    if (t && t.v) record("terms", t.v, 0, t.at);
    var s = saved();
    Object.keys(s).forEach(function (k) { if (s[k] && s[k].v && KIND[k]) record(k, s[k].v, s[k].season || 0, s[k].at); });
    flush();
  }
  var TKEY_EARLY = "tf:termsOk";
  addEventListener("load", function () { setTimeout(backfill, 4000); }, { once: true });
  addEventListener("online", function () { flush(); });
  var css = "#tfRisk{position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.45)}" +
    "#tfRisk .rk{background:var(--panel,#fff);color:var(--fg,#1d2420);width:100%;max-width:480px;max-height:88vh;overflow:auto;border-radius:16px 16px 0 0;padding:18px 18px calc(env(safe-area-inset-bottom) + 16px);box-shadow:0 -6px 24px rgba(0,0,0,.25);font:15px/1.45 system-ui,-apple-system,sans-serif}" +
    "@media (min-width:700px){#tfRisk{align-items:center}#tfRisk .rk{border-radius:16px}}" +
    "#tfRisk h2{margin:0 0 8px;font-size:1.15rem}#tfRisk p{margin:0 0 9px}#tfRisk .rk-b{font-weight:600}" +
    "#tfRisk .rk-btns{display:flex;gap:8px;margin-top:14px}#tfRisk button{flex:1;min-height:46px;border-radius:10px;font:600 15px system-ui,sans-serif;border:1px solid var(--line,#d9dfda);background:transparent;color:inherit;cursor:pointer}" +
    "#tfRisk button.rk-ok{background:var(--accent,#1f6f4a);border-color:var(--accent,#1f6f4a);color:#fff;flex:2}#tfRisk a{color:var(--accent,#1f6f4a)}" +
    "dialog.tf-terms{border:0;border-radius:20px;background:var(--panel,#fff);color:var(--fg,#1d2420);padding:18px 18px 14px;width:min(440px,calc(100vw - 24px));max-height:calc(100dvh - 24px);box-sizing:border-box;box-shadow:0 14px 50px rgba(0,0,0,.4);font:15px/1.45 system-ui,-apple-system,sans-serif;overflow:auto}" +
    "dialog.tf-terms::backdrop{background:rgba(6,16,10,.6)}dialog.tf-terms:focus{outline:none}" +
    "dialog.tf-terms h2{margin:0 0 6px;font-family:var(--font-display,system-ui);font-size:1.45rem;line-height:1.15}" +
    "dialog.tf-terms .tt-lead{margin:0 0 10px;color:var(--muted,#5c6862);font-size:.93rem}" +
    "dialog.tf-terms ul{margin:0 0 10px;padding-left:20px;display:flex;flex-direction:column;gap:7px;font-size:.92rem;line-height:1.4}" +
    "dialog.tf-terms .tt-go{display:block;width:100%;margin-top:12px;font:inherit;font-weight:800;font-size:1.02rem;padding:13px;min-height:48px;border-radius:14px;border:0;background:var(--cta,var(--accent,#1f6f4a));color:var(--cta-fg,#fff);cursor:pointer}" +
    "dialog.tf-terms .tt-read{display:block;text-align:center;padding:10px;min-height:44px;box-sizing:border-box;color:var(--accent,#1f6f4a);font-weight:600}" +
    "dialog.tf-terms .tt-note{color:var(--muted,#5c6862);font-size:.8rem;margin:2px 0 0;text-align:center}" +
    ".tf-risk-line{font-size:.72rem;color:var(--muted,#5c6862);margin:8px 0 0;line-height:1.4}.tf-risk-line a{color:inherit}";
  var open = null;
  // Resolves true once the person has accepted this kind (now or before), false if they cancel.
  window.tfRiskOk = function (kind) {
    if (!KIND[kind]) kind = "route";
    if (accepted(kind)) return Promise.resolve(true);
    if (open) return open;
    if (!document.getElementById("tfRiskCss")) { var st = document.createElement("style"); st.id = "tfRiskCss"; st.textContent = css; document.head.appendChild(st); }
    open = new Promise(function (done) {
      var el = document.createElement("div");
      el.id = "tfRisk"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "tfRiskH");
      el.innerHTML = '<div class="rk"><h2 id="tfRiskH">Your trip, your decisions</h2>' +
        "<p>Trail Finder helps you plan. Its maps, routes, forecasts and ratings can be wrong or out of date.</p>" +
        "<p>" + KIND[kind] + "</p>" +
        '<p class="rk-b">You decide where you go and what you do, and you accept all the risk: accidents, injury, death, lost or damaged gear and vehicles, and rescue costs.</p>' +
        '<p class="rk-b">Trail Finder and the people who make it are not responsible for your decisions or for anything that happens on your trip.</p>' +
        '<p>Check conditions yourself, stay within your skills, and call 911 in an emergency. <a href="terms.html">Terms of use</a></p>' +
        '<div class="rk-btns"><button type="button" data-rk="no">Cancel</button><button type="button" class="rk-ok" data-rk="ok">I understand and accept</button></div></div>';
      function close(ok) { el.remove(); open = null; if (ok) remember(kind); done(ok); }
      el.addEventListener("click", function (e) {
        var b = e.target.closest("[data-rk]");
        if (b) close(b.dataset.rk === "ok");
        else if (e.target === el) close(false);
      });
      document.body.appendChild(el);
      var ok = el.querySelector(".rk-ok"); if (ok) ok.focus();
    });
    return open;
  };
  window.tfRiskLine = function () {
    if (!document.getElementById("tfRiskCss")) { var st = document.createElement("style"); st.id = "tfRiskCss"; st.textContent = css; document.head.appendChild(st); }
    return '<p class="tf-risk-line">You make your own decisions and go at your own risk. Trail Finder isn\'t responsible for what happens. <a href="terms.html">Terms</a></p>';
  };

  // Before you head out: the terms in five lines, agreed once on each device before the app is used (clickwrap). No
  // Cancel: the app is only for people who agree; Read the Terms of use opens the full page and the sheet comes back.
  // ?nowelcome (the photo-find test) skips it; the phone test taps I agree like a person would.
  var TKEY = "tf:termsOk", TERMS_V = 1, termsMem = false;
  function termsAccepted() {
    if (termsMem) return true;
    try { var t = JSON.parse(localStorage.getItem(TKEY) || "null"); return !!(t && t.v >= TERMS_V); } catch (e) { return false; }
  }
  var skip = /[?&]nowelcome\b/.test(location.search) || /(^|\/)(terms|privacy|support|credits)\.html$/.test(location.pathname);
  var terms = window.tfTerms = { pending: !skip && !termsAccepted(), v: TERMS_V };
  terms.accepted = termsAccepted;
  function showTerms() {
    if (!terms.pending || document.querySelector("dialog.tf-terms")) return;
    if (!document.getElementById("tfRiskCss")) { var st = document.createElement("style"); st.id = "tfRiskCss"; st.textContent = css; document.head.appendChild(st); }
    var d = document.createElement("dialog");
    d.className = "tf-terms"; d.tabIndex = -1; d.setAttribute("aria-labelledby", "tfTermsH");
    d.innerHTML = '<h2 id="tfTermsH">Before you head out</h2>' +
      '<p class="tt-lead">Trail Finder helps you plan. It doesn\'t decide for you.</p><ul>' +
      "<li>Maps, routes, the Less exposed way, avalanche and terrain ratings, forecasts, trail and road status, GPS tracks and other people's posts can be wrong, late or missing.</li>" +
      "<li>Nothing in the app is advice or a promise that a place is safe, open or allowed.</li>" +
      "<li><b>You decide whether to go, where, which way and when to turn back, and you accept all the risk, for you and anyone with you.</b></li>" +
      "<li><b>Trail Finder and the people who make it are not responsible for your decisions or what happens: accidents, injury, death, rescue costs, loss or damage.</b></li>" +
      "<li>Get the training and gear your sport needs, check official sources, and call 911 in an emergency.</li></ul>" +
      '<button type="button" class="tt-go" data-terms="ok">I agree</button>' +
      '<a class="tt-read" href="terms.html">Read the Terms of use</a>' +
      '<p class="tt-note">By tapping I agree you accept the Terms of use. Under the age of majority? A parent or guardian agrees for you.</p>';
    d.addEventListener("cancel", function (e) { e.preventDefault(); });   // Escape or back doesn't agree for you
    d.addEventListener("click", function (e) {
      if (!e.target.closest("[data-terms=ok]")) return;
      termsMem = true; terms.pending = false;
      var at = new Date().toISOString();
      try { localStorage.setItem(TKEY, JSON.stringify({ v: TERMS_V, at: at })); } catch (x) {}
      record("terms", TERMS_V, 0, at);
      d.close(); d.remove();
      document.dispatchEvent(new CustomEvent("tf:terms"));
    });
    document.body.appendChild(d);
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    d.focus({ preventScroll: true });
  }
  if (terms.pending) {
    // At once, while the rest of the app downloads behind it (alex, 2026-11-06, first impressions): it used to wait for
    // the whole page (~3.5 s on a phone with 4G, the screen showing buttons that did nothing yet); reading it covers that
    // time. risk.js runs in <body> after the app's own markup, so the sheet has a body and the theme to sit in.
    if (document.body) setTimeout(showTerms, 0); else addEventListener("DOMContentLoaded", function () { setTimeout(showTerms, 0); }, { once: true });
  }
})();
