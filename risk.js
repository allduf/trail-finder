// Your trip, your decisions (alex 2026-11-04: "we need to be clear that we are in no circumstance responsible for the
// decision the user made ... accident and everything"). Before the first route or tour a person asks for in each kind
// of planning, a sheet says plainly that the app is a planning aid, they decide and take all the risk, and Trail Finder
// isn't responsible; they tap I understand and accept (kept on this device per kind, asked again when ACK_V changes
// with the terms). tfRiskLine() is the one short line under every planned route that says the same with a Terms link.
// The wording follows terms.html, whose full version still waits on a lawyer's review (see the terms draft doc).
(function () {
  "use strict";
  var KEY = "tf:riskOk", ACK_V = 1;
  var KIND = {
    avy: "Avalanche danger, slope angles and the Safest way are a computer's estimate from a terrain model and a regional forecast. They can't see today's snowpack, and a safe-looking line can still slide.",
    offtrail: "Off-trail routes follow a terrain model and map data. They can cross private land, cliffs, high water, wildlife and closed areas the map doesn't know about.",
    route: "Routes can use trails and roads that are closed, private, unofficial, washed out or beyond your skills.",
  };
  function saved() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function accepted(kind) { var s = saved()[kind]; return !!(s && s.v >= ACK_V); }
  function remember(kind) {
    var s = saved(); s[kind] = { v: ACK_V, at: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }
  var css = "#tfRisk{position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.45)}" +
    "#tfRisk .rk{background:var(--panel,#fff);color:var(--fg,#1d2420);width:100%;max-width:480px;max-height:88vh;overflow:auto;border-radius:16px 16px 0 0;padding:18px 18px calc(env(safe-area-inset-bottom) + 16px);box-shadow:0 -6px 24px rgba(0,0,0,.25);font:15px/1.45 system-ui,-apple-system,sans-serif}" +
    "@media (min-width:700px){#tfRisk{align-items:center}#tfRisk .rk{border-radius:16px}}" +
    "#tfRisk h2{margin:0 0 8px;font-size:1.15rem}#tfRisk p{margin:0 0 9px}#tfRisk .rk-b{font-weight:600}" +
    "#tfRisk .rk-btns{display:flex;gap:8px;margin-top:14px}#tfRisk button{flex:1;min-height:46px;border-radius:10px;font:600 15px system-ui,sans-serif;border:1px solid var(--line,#d9dfda);background:transparent;color:inherit;cursor:pointer}" +
    "#tfRisk button.rk-ok{background:var(--accent,#1f6f4a);border-color:var(--accent,#1f6f4a);color:#fff;flex:2}#tfRisk a{color:var(--accent,#1f6f4a)}" +
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
})();
