// More → Send feedback, in every sport (alex 2026-11-19, "Recruit early testers"). A short note, an optional picture
// (a screenshot from the phone's photos) and, added on its own, the app version, iPhone app / Android app / website and
// the sport. It goes to a private table (supabase/testers.sql, tf_feedback_add) that only alex reads on
// usage.html → Manage. The Android app had no feedback route (TestFlight has its own on iPhone).
// window.tfFeedback.open() opens it; index.html shows the More card only when this file has loaded.
(() => {
  "use strict";
  if (window.tfFeedback) return;
  const APP_V = ((document.currentScript && document.currentScript.src.match(/[?&]v=(\d+)/)) || [])[1] || "";
  const MAX = 1000;
  const T = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const where = () => {
    const C = window.Capacitor, native = !!(C && C.isNativePlatform && C.isNativePlatform());
    const plat = native ? ((C.getPlatform && C.getPlatform()) || "ios") : "web", ua = navigator.userAgent;
    const sys = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad" : /Android/.test(ua) ? "Android"
      : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : "other";
    const os = plat === "android" ? (ua.match(/Android [\d.]+/) || ["Android"])[0] : plat === "ios" ? "iOS" : sys;
    return { label: plat === "ios" ? "iPhone app" : plat === "android" ? "Android app" : "Website", full: `${plat === "ios" ? "iPhone app" : plat === "android" ? "Android app" : "Website"} · ${os} · ${Math.min(screen.width, screen.height)}x${Math.max(screen.width, screen.height)}` };
  };
  const sport = () => { const m = (document.body.className.match(/\bsport-(\w+)/) || [])[1]; return m || "mtb"; };

  const css = document.createElement("style");
  css.textContent = `
dialog.tffb { border: 0; border-radius: 20px; background: var(--panel, #fff); color: var(--fg, #1d2420); padding: 18px 16px 14px; width: min(440px, calc(100vw - 24px)); max-height: calc(100dvh - 48px); box-sizing: border-box; box-shadow: 0 14px 50px rgba(0,0,0,.4); font: inherit; overflow: auto; }
dialog.tffb::backdrop { background: rgba(0,0,0,.45); }
dialog.tffb h2 { margin: 0 0 4px; font-size: 1.2rem; }
dialog.tffb .fb-lead { margin: 0 0 10px; color: var(--muted, #5c6862); font-size: .92rem; line-height: 1.35; }
dialog.tffb textarea { width: 100%; min-height: 120px; box-sizing: border-box; font: inherit; font-size: 16px; padding: 10px 12px; border: 1px solid var(--line, #d9dfda); border-radius: 12px; background: var(--bg, #f3f5f2); color: inherit; resize: vertical; }
dialog.tffb .fb-count { text-align: right; color: var(--muted, #5c6862); font-size: .8rem; margin: 2px 0 8px; }
dialog.tffb .fb-pic { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; }
dialog.tffb .fb-pic img { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line, #d9dfda); }
dialog.tffb button { font: inherit; min-height: 44px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line, #d9dfda); background: var(--bg, #f3f5f2); color: inherit; cursor: pointer; }
dialog.tffb .fb-row { display: flex; gap: 8px; margin-top: 8px; }
dialog.tffb .fb-row button { flex: 1; }
dialog.tffb button.fb-send { background: var(--accent, #1f6f4a); color: #fff; border-color: transparent; font-weight: 600; }
dialog.tffb button:disabled { opacity: .6; }
dialog.tffb .fb-info { color: var(--muted, #5c6862); font-size: .82rem; line-height: 1.35; margin: 8px 0 0; }
dialog.tffb .fb-msg { min-height: 1.2em; margin: 8px 0 0; font-size: .9rem; color: var(--muted, #5c6862); }
dialog.tffb .fb-msg.err { color: #c92a2a; }
dialog.tffb .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }`;
  document.head.append(css);

  // A picture shrunk on the phone to at most 1280 px, as a JPEG small enough for the table (under about 500 KB).
  const shrink = (file) => new Promise((ok, bad) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try {
        let side = 1280, q = 0.72, out = "";
        for (let i = 0; i < 6; i++) {
          const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          out = c.toDataURL("image/jpeg", q);
          if (out.length < 650000) break;
          side = Math.round(side * 0.8); q = Math.max(0.5, q - 0.06);
        }
        URL.revokeObjectURL(url);
        out.length < 690000 && out.startsWith("data:image/jpeg;base64,") ? ok(out) : bad(new Error("too big"));
      } catch (e) { URL.revokeObjectURL(url); bad(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); bad(new Error("not a picture")); };
    img.src = url;
  });

  let dlg = null, shot = null;
  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "tffb";
    dlg.setAttribute("aria-labelledby", "fbTitle");
    dlg.innerHTML = `<h2 id="fbTitle">Send feedback</h2>
      <p class="fb-lead">A bug, a trail that's wrong, an idea? Only the Trail Finder team reads it.</p>
      <form method="dialog" novalidate>
        <textarea id="fbText" maxlength="${MAX}" aria-label="Your feedback" placeholder="What happened, or what would help?"></textarea>
        <div class="fb-count"><span id="fbCount">0</span> / ${MAX}</div>
        <div class="fb-pic"><button type="button" id="fbPick">Add a screenshot</button><img id="fbThumb" alt="" hidden><button type="button" id="fbDrop" hidden>Remove</button></div>
        <input type="file" id="fbFile" accept="image/*" hidden>
        <div class="hp" aria-hidden="true"><input type="text" id="fbHp" tabindex="-1" autocomplete="off"></div>
        <p class="fb-info" id="fbInfo"></p>
        <p class="fb-msg" id="fbMsg" role="status" aria-live="polite"></p>
        <div class="fb-row"><button type="button" id="fbClose">Close</button><button type="submit" class="fb-send" id="fbSend">Send</button></div>
      </form>`;
    document.body.append(dlg);
    const $ = (id) => dlg.querySelector("#" + id), text = $("fbText"), msg = $("fbMsg");
    const say = (s, err) => { msg.textContent = T(s); msg.className = "fb-msg" + (err ? " err" : ""); };
    text.addEventListener("input", () => { $("fbCount").textContent = String(text.value.length); });
    $("fbClose").addEventListener("click", () => dlg.close());
    $("fbPick").addEventListener("click", () => $("fbFile").click());
    $("fbDrop").addEventListener("click", () => { shot = null; $("fbThumb").hidden = true; $("fbDrop").hidden = true; $("fbPick").hidden = false; });
    $("fbFile").addEventListener("change", async () => {
      const f = $("fbFile").files && $("fbFile").files[0]; $("fbFile").value = "";
      if (!f) return;
      say("Getting the picture ready…");
      try {
        shot = await shrink(f);
        $("fbThumb").src = shot; $("fbThumb").hidden = false; $("fbDrop").hidden = false; $("fbPick").hidden = true; say("");
      } catch { shot = null; say("That picture couldn't be added. Try a screenshot.", true); }
    });
    dlg.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = text.value.trim();
      if (body.length < 2) { say("Write a few words first.", true); text.focus(); return; }
      const w = where(), args = { body: body.slice(0, MAX), shot, sport: sport(), app_v: APP_V, platform: w.full.slice(0, 60),
        page: (location.pathname.split("/").pop() || "index").replace(/\.html$/, "").slice(0, 20) || "index",
        lang: window.tfLang && window.tfLang.lang === "fr" ? "fr" : "en", hp: $("fbHp").value };
      $("fbSend").disabled = true; say("Sending…");
      let out = null;
      try {
        const a = window.tfAccount;
        if (a && a.client && a.user) {   // signed in: the note is tied to the account, so a reply can reach the right person
          const { data, error } = await a.client.rpc("tf_feedback_add", args);
          if (!error) out = data;
        } else if (a && a.enabled) {
          const res = await fetch(`${a.url}/rest/v1/rpc/tf_feedback_add`, { method: "POST",
            headers: { "Content-Type": "application/json", apikey: a.key, Authorization: `Bearer ${a.key}` }, body: JSON.stringify(args) });
          if (res.ok) out = await res.json();
        }
      } catch {}
      $("fbSend").disabled = false;
      if (out === "ok") {
        text.value = ""; $("fbCount").textContent = "0"; $("fbDrop").click();
        say("Thanks, it's sent.");
        setTimeout(() => { if (dlg.open) dlg.close(); say(""); }, 1600);
      } else say(out === "busy" ? "Too many notes from this connection today. Please try again tomorrow." : "Couldn't send. Check your signal and try again.", true);
    });
  }
  function open() {
    if (!dlg) build();
    const w = where();
    dlg.querySelector("#fbInfo").innerHTML = `${esc(T("Sent with it"))}: ${esc(T(w.label))}${APP_V ? `, ${esc(T("version"))} ${esc(APP_V)}` : ""}, ${esc(T("the sport you're in"))}. ${esc(T("No location."))} <a href="privacy.html" target="_blank" rel="noopener">${esc(T("Privacy"))}</a>`;
    if (!dlg.open) dlg.showModal();
    setTimeout(() => { const t = dlg.querySelector("#fbText"); if (t && !t.value) t.focus(); }, 50);
  }
  window.tfFeedback = { open };
})();
