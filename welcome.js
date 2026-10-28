// First-open welcome (alex, 2026-10-27: testers stay a minute or two and never search or save). A brand-new device gets
// three short screens before anything else: pick your sport, allow location, and what the map's words mean for that
// sport (each sport its own wording, nothing about bikes outside MTB and Adventure moto). Skip closes it at any step.
//  - Loaded before the app's main script, so "brand new" is read before the app saves its first settings, and the app
//    waits for step 2 to ask for location (window.tfWelcome.pending) instead of asking the moment it opens.
//  - tf:welcomed = true once it's closed; devices that used the app before never see it.
//  - Location: "Allow location" taps the map's Me button (centres the map on you and finds what's around); "Not now"
//    keeps the app from asking on later opens (tf:track = false) until Me is tapped.
(() => {
  "use strict";
  const KEY = "tf:welcomed";
  const has = (k) => { try { return localStorage.getItem(k) != null; } catch { return true; } };
  const usedBefore = (() => {
    try {
      const v = JSON.parse(localStorage.getItem("tf:notifyVisit"));
      if (v) return true;
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("tf:")) return true; }
    } catch { return true; }   // no storage: it couldn't remember being closed, so don't show it at all
    return false;
  })();
  const pending = !has(KEY) && !usedBefore && !/[?&]nowelcome\b/.test(location.search);
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const SPORTS = [
    ["mtb", "🚵", "Mountain biking", "Trails new to you, and where the dirt is best today"],
    ["ski", "⛷", "Skiing", "Ski tours, avalanche forecast, huts and resorts"],
    ["hunt", "🦌", "Hunting", "Zones, open seasons, no-shooting areas and wind"],
    ["fish", "🎣", "Fishing", "Stocked lakes, fishing rules and river flow"],
    ["moto", "🏍", "Adventure moto", "Gravel and back roads graded for your bike"],
  ];
  // Step 2 (why location helps) and step 3 (what you'll see), in each sport's own words.
  const WORDS = {
    mtb: {
      here: "The map opens where you are and lists the trails around you, starting with the ones you probably haven't ridden yet.",
      lines: [
        ["New", "new", "Trails added to the map in the last 6 months: the ones you likely don't know yet. Pick how new in Find."],
        ["Loam", "loam", "How damp the dirt is right now. <b>Prime loam</b> (teal dots) is the best riding today, <b>Tacky</b> is good, dry or wet less so."],
        ["Tap", "tap", "Tap any trail for its level, weather and loam. Colours like Trailforks: green, blue, black, red."],
      ],
      go: "Find new trails",
    },
    ski: {
      here: "The map opens on the mountains around you, with today's avalanche danger for that area.",
      lines: [
        ["Danger", "avy", "Today's avalanche forecast from Avalanche Canada, from Low (green) to Extreme (black). Always read the full forecast."],
        ["Tours", "tour", "Ski tours, huts and trailhead parking. Tap a tour for its climb, steep parts and today's light: Normal, Extra caution or Not recommended."],
        ["Tap", "tap", "Tap anywhere on the mountain for its slope, aspect, height and snow."],
      ],
      go: "Start skiing",
    },
    hunt: {
      here: "The map opens where you are, with the hunting zone you're in and its open seasons.",
      lines: [
        ["Zones", "zone", "Hunting zones with their numbers. Tap the map for that zone's open seasons (● Open today) and rules."],
        ["Red", "red", "Red means no shooting: towns, parks and closures where hunting isn't allowed."],
        ["Wind", "wind", "The orange cone shows where the wind takes your scent, right now."],
      ],
      go: "Start hunting",
    },
    fish: {
      here: "The map opens where you are, with the lakes and rivers nearby and when they were last stocked.",
      lines: [
        ["Today", "new", "Where to fish today: stocked lakes and rivers near you, best first."],
        ["Tap", "tap", "Tap a lake, river or the sea for its rules, its fish and the last stocking."],
        ["Private", "priv", "Your catches and spots stay yours: there's no public catch map."],
      ],
      go: "Start fishing",
    },
    moto: {
      here: "The map opens where you are, with the roads around you coloured for your bike.",
      lines: [
        ["Bike", "tour", "Set up your bike first (in the panel): every road is graded for it and your fuel range."],
        ["Colours", "road", "<b style=\"color:#2f9e44\">Green</b> fine for your bike, <b style=\"color:#f08c00\">orange</b> hard, <b style=\"color:#e03131\">red</b> not for it."],
        ["Tap", "tap", "Tap a road for its surface, closures and what's on the way."],
      ],
      go: "Start riding",
    },
  };

  window.tfWelcome = { pending, open: () => open(true) };
  if (!pending) return;

  const css = document.createElement("style");
  css.textContent = `
dialog.welc { border: 0; border-radius: 20px; background: var(--panel); color: var(--fg); padding: 18px 18px 14px; width: min(420px, calc(100vw - 24px)); box-sizing: border-box; box-shadow: 0 14px 50px rgba(0,0,0,.4); font: inherit; overflow: auto; }
dialog.welc::backdrop { background: rgba(6,16,10,.55); }
dialog.welc .welc-top { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
dialog.welc .welc-dots { display: flex; gap: 6px; flex: 1; }
dialog.welc .welc-dots i { width: 22px; height: 5px; border-radius: 3px; background: var(--line); }
dialog.welc .welc-dots i.on { background: var(--accent); }
dialog.welc .welc-skip { font: inherit; font-size: .9rem; background: none; border: 0; color: var(--muted); padding: 6px 4px; cursor: pointer; }
dialog.welc h2 { margin: 0 0 4px; font-family: var(--font-display); font-size: 1.45rem; line-height: 1.15; }
dialog.welc .welc-lead { margin: 0 0 12px; color: var(--muted); font-size: .95rem; line-height: 1.35; }
dialog.welc .welc-sports { display: flex; flex-direction: column; gap: 8px; }
dialog.welc .welc-sports button { display: grid; grid-template-columns: 40px 1fr; align-items: center; column-gap: 10px; text-align: left; font: inherit; color: var(--fg); background: var(--chip); border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; cursor: pointer; min-height: 58px; }
dialog.welc .welc-sports button:active { transform: scale(.98); }
dialog.welc .welc-sports .i { grid-row: span 2; font-size: 1.7rem; text-align: center; }
dialog.welc .welc-sports b { font-size: 1.02rem; }
dialog.welc .welc-sports small { color: var(--muted); font-size: .82rem; line-height: 1.25; }
dialog.welc .welc-pin { text-align: center; margin: 0 0 6px; line-height: 0; }
dialog.welc:focus { outline: none; }
dialog.welc .welc-note { color: var(--muted); font-size: .82rem; margin: 10px 0 0; text-align: center; }
dialog.welc .welc-lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
dialog.welc .welc-lines li { display: grid; grid-template-columns: 64px 1fr; gap: 10px; align-items: start; font-size: .93rem; line-height: 1.35; }
dialog.welc .welc-tag { display: inline-block; text-align: center; font-size: .72rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; border-radius: 8px; padding: 5px 2px; background: var(--chip); color: var(--fg); border: 1px solid var(--line); }
dialog.welc .welc-tag.new { background: #1f7a4d; color: #fff; border-color: #1f7a4d; }
dialog.welc .welc-tag.loam { background: #14b8a6; color: #04201c; border-color: #14b8a6; }
dialog.welc .welc-tag.avy { background: linear-gradient(90deg, #52b947 0 33%, #fff200 33% 66%, #f7941e 66%); color: #111; border-color: transparent; }
dialog.welc .welc-tag.red { background: #e03131; color: #fff; border-color: #e03131; }
dialog.welc .welc-tag.wind { background: #f08c00; color: #111; border-color: #f08c00; }
dialog.welc .welc-tag.zone { background: #222; color: #fff; border-color: #fff; box-shadow: 0 0 0 1px #222; }
dialog.welc .welc-tag.tour { background: #2b7de9; color: #fff; border-color: #2b7de9; }
dialog.welc .welc-tag.road { background: linear-gradient(90deg, #2f9e44 0 33%, #f08c00 33% 66%, #e03131 66%); color: #fff; border-color: transparent; }
dialog.welc .welc-tag.priv { background: #555; color: #fff; border-color: #555; }
dialog.welc .welc-go { display: block; width: 100%; margin-top: 16px; font: inherit; font-weight: 800; font-size: 1.02rem; padding: 13px; border-radius: 14px; border: 0; background: var(--cta); color: var(--cta-fg); cursor: pointer; }
dialog.welc .welc-later { display: block; width: 100%; margin-top: 6px; font: inherit; padding: 10px; background: none; border: 0; color: var(--muted); cursor: pointer; }`;
  document.head.append(css);

  let dlg = null, sport = "mtb", step = 0;
  const canLocate = () => !!navigator.geolocation && !!document.getElementById("locate");
  const steps = () => (canLocate() ? 3 : 2);
  function close() {
    set(KEY, true); set("tf:tipSeen", true);   // the small "New here?" tip says the same as step 3
    const tip = document.getElementById("firstTip"); if (tip) tip.hidden = true;
    window.tfWelcome.pending = false;
    if (dlg && dlg.open) dlg.close();
    if (window.tfLocateAfterWelcome) window.tfLocateAfterWelcome();   // Skip: still open on the rider, not all of BC
  }
  function render() {
    const n = steps(), at = step === 2 && n === 2 ? 1 : step;
    const top = `<div class="welc-top"><div class="welc-dots" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i class="${i <= at ? "on" : ""}"></i>`).join("")}</div><button type="button" class="welc-skip" data-skip>Skip</button></div>`;
    const w = WORDS[sport];
    if (step === 0) {
      dlg.innerHTML = `${top}<h2>Welcome to Trail Finder</h2><p class="welc-lead">What are you out for? You can switch any time with the sport button on the map.</p>
        <div class="welc-sports" role="list">${SPORTS.map(([id, icon, name, sub]) => `<button type="button" role="listitem" data-sport="${id}"><span class="i" aria-hidden="true">${icon}</span><b>${name}</b><small>${sub}</small></button>`).join("")}</div>`;
    } else if (step === 1) {
      dlg.innerHTML = `${top}<div class="welc-pin" aria-hidden="true"><svg viewBox="0 0 24 24" width="52" height="52"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7z" fill="#e03131"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg></div><h2>See what's around you</h2><p class="welc-lead">${w.here}</p>
        <button type="button" class="welc-go" data-loc>Allow location</button><button type="button" class="welc-later" data-next>Not now</button>
        <p class="welc-note">Only used to show you on the map and find what's close. Turn it off any time in your phone's settings.</p>`;
    } else {
      const icon = SPORTS.find((s) => s[0] === sport)[1];
      dlg.innerHTML = `${top}<h2>${icon} What you'll see</h2><p class="welc-lead">Three things to know, then you're set.</p>
        <ul class="welc-lines">${w.lines.map(([tag, cls, text]) => `<li><span class="welc-tag ${cls}">${tag}</span><span>${text}</span></li>`).join("")}</ul>
        <button type="button" class="welc-go" data-done>${w.go}</button>`;
    }
    dlg.scrollTop = 0;
    if (dlg.open) dlg.focus({ preventScroll: true });
  }
  function pickSport(s) {
    sport = s;
    const sel = document.getElementById("sport");
    if (sel && sel.value !== s) { sel.value = s; sel.dispatchEvent(new Event("change", { bubbles: true })); }
  }
  function open(force) {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "welc";
      dlg.setAttribute("aria-label", "Welcome to Trail Finder");
      dlg.tabIndex = -1;
      dlg.addEventListener("cancel", close);   // Escape or the back gesture closes it like Skip
      dlg.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.skip != null) { close(); return; }
        if (b.dataset.done != null) {
          close();
          // MTB's button says "Find new trails": show them (the New trails chip runs the search and shows the list).
          if (sport === "mtb") setTimeout(() => document.querySelector('#peekQuick [data-q="new"]')?.click(), 400);
          return;
        }
        if (b.dataset.sport) { pickSport(b.dataset.sport); step = canLocate() ? 1 : 2; render(); return; }
        if (b.dataset.loc != null) { set("tf:track", true); document.getElementById("locate").click(); step = 2; render(); return; }
        if (b.dataset.next != null) { set("tf:track", false); step = 2; render(); }
      });
      document.body.append(dlg);
    }
    if (force) { const sel = document.getElementById("sport"); sport = (sel && sel.value) || "mtb"; }
    step = 0; render();
    if (!dlg.open) dlg.showModal();
    dlg.focus({ preventScroll: true });   // not on Skip, which would show its focus ring
  }
  // As soon as the page is ready (another popup open first: wait for it).
  const start = (tries = 20) => {
    if (!window.tfWelcome.pending) return;
    if (document.querySelector("dialog[open]") && tries > 0) { setTimeout(() => start(tries - 1), 500); return; }
    open();
  };
  if (document.readyState === "complete") setTimeout(start, 300); else addEventListener("load", () => setTimeout(start, 300), { once: true });
})();
