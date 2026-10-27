// Ask in plain words (alex approved from the competitor review, 2026-10-27): one box on every sport's Find page, like
// "2-hour loop with prime loam near Squamish tomorrow". The free AI (Gemini, in the photo function, mode "ask": its own
// daily limits per app and per person) only reads the words and says what to look for: the place, the day, the length,
// the levels, prime loam, new... The answer always comes from the app's own data, the same as the rest of the app:
//  - MTB: loops (loops.js: from a parking lot, never bike park trails), trails (the All trails lists, the shared Loam
//    readings for that day, new trails, your Ridden list) or riding areas (data/riding-areas.json).
//  - Skiing: tours, nordic, snowshoe or snowmobile routes with their risk light, huts, the avalanche forecast (winter.js).
//  - Hunting: the spot card at the place (zone, what's open, rules: hunting.js).
//  - Fishing: stocked waters near the place, for the fish named (fishing.js), or the spot card.
//  - Adventure moto: ADV routes near the place (data/moto-routes.json), or the spot card.
// When the AI isn't there (no signal to it, its daily limit reached, the function not updated yet) the words are read
// here, more simply, and the answer says so.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L || window.tfAsk) return;
  const AI_FN = "smooth-worker";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const kmTo = (a, b) => Math.hypot((a[1] - b[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180), (a[0] - b[0]) * 110.57);
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const sportOf = () => ["ski", "hunt", "fish", "moto"].find((s) => document.body.classList.contains("sport-" + s)) || "mtb";
  const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00"); d.setDate(d.getDate() + n); return localDay(d); };
  const dayName = (d) => {
    const n = Math.round((Date.parse(d + "T12:00") - Date.parse(localDay() + "T12:00")) / 864e5);
    return n <= 0 ? "today" : n === 1 ? "tomorrow" : new Date(d + "T12:00").toLocaleDateString(undefined, { weekday: "long" });
  };
  const fmtKm = (k) => (k < 1 ? "under 1 km" : `${k < 10 ? k.toFixed(1) : Math.round(k)} km`);

  // Each sport's own words (alex, 2026-10-26: "every mode should have its own feature").
  const SP = {
    mtb: { ph: "2-hour loop in prime loam near Squamish tomorrow", ex: ["2-hour loop in prime loam near Squamish tomorrow", "New blue trails near Pemberton I haven't ridden", "Where to ride today near me"] },
    ski: { ph: "Simple ski tour near Whistler", ex: ["Simple ski tour near Whistler", "Huts near Rogers Pass", "Avalanche danger near Revelstoke tomorrow"] },
    hunt: { ph: "What can I hunt near Pemberton", ex: ["What can I hunt near Pemberton", "Elk near Canmore", "Deer season near Kamloops"] },
    fish: { ph: "Lakes stocked with rainbow trout near Kamloops", ex: ["Lakes stocked with rainbow trout near Kamloops", "Where to fish near Squamish", "Fishing rules near Banff"] },
    moto: { ph: "Dirt route under 300 km near Kamloops", ex: ["Dirt route under 300 km near Kamloops", "ADV routes near Revelstoke", "Gas and camping near Lillooet"] },
  };

  const css = document.createElement("style");
  css.textContent = `
form.ask-box { display: flex; flex-direction: column; gap: 5px; margin: 0; }
form.ask-box label { font-size: .78rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.ask-row { display: flex; gap: 6px; }
.ask-in { flex: 1; min-width: 0; font: inherit; font-size: 16px; box-sizing: border-box; padding: 9px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); color: var(--fg); }
.ask-go { font: inherit; font-size: .9rem; font-weight: 700; padding: 0 16px; min-height: 42px; border-radius: 12px; border: 0; background: #1f5fe0; color: #fff; cursor: pointer; }
.hub form.ask-box { margin: 10px 0 2px; }
#panel > .panel-head form.ask-box.ask-desk { margin: 2px 0 8px; }
dialog.ask-dlg form.ask-box label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 760px) {
  form.ask-box.ask-desk { display: none; }
  /* the sports' Find pages are in a set order (theme.css): the box goes right under their search box */
  html body :is(#skiPane, #huntPane, #fishPane, #motoPane) form.ask-box { order: 1; }
  html body .panel:not(.nav-alt) :is(#skiPane, #huntPane, #fishPane, #motoPane) form.ask-box { display: none; }
}
dialog.ask-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 14px; width: min(540px, calc(100vw - 16px)); max-height: calc(100dvh - 24px); overflow: auto; box-sizing: border-box; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.ask-dlg::backdrop { background: rgba(0,0,0,.45); }
dialog.ask-dlg h2 { margin: 0 0 8px; font-family: var(--font-display); font-size: 1.25rem; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
dialog.ask-dlg h2 button { font: inherit; border: 0; background: none; color: var(--muted); font-size: 1.3rem; cursor: pointer; min-width: 40px; min-height: 40px; }
dialog.ask-dlg h3 { margin: 14px 0 6px; font-size: .76rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.ask-said { margin: 10px 0 0; font-size: .92rem; font-weight: 650; }
.ask-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 0; padding: 0; list-style: none; }
.ask-chips li { font-size: .76rem; padding: 2px 9px; border-radius: 999px; background: var(--chip, #eef1f4); border: 1px solid var(--line); }
.ask-note { margin: 6px 0 0; color: var(--muted); font-size: .8rem; }
.ask-warn { color: #b45309; }
.ask-ex { display: flex; flex-direction: column; gap: 5px; margin: 6px 0 0; }
.ask-ex button { all: unset; box-sizing: border-box; cursor: pointer; font-size: .86rem; padding: 8px 10px; border-radius: 10px; border: 1px dashed var(--line); color: #1f5fe0; }
ol.ask-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
ol.ask-list > li > button { width: 100%; text-align: left; font: inherit; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--line); background: var(--chip, #fff); color: var(--fg); cursor: pointer; display: flex; flex-direction: column; gap: 2px; min-height: 44px; }
ol.ask-list b { font-size: .96rem; } ol.ask-list small { color: var(--muted); font-size: .8rem; }
.ask-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; }
.ask-new { display: inline-block; font-size: .7rem; font-weight: 800; padding: 1px 7px; border-radius: 999px; background: #b8f03a; color: #10230f; margin-left: 6px; vertical-align: 1px; }
.ask-lv { font-weight: 800; margin-right: 4px; }
.ask-areas { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 4px; }
.ask-areas button { font: inherit; font-size: .82rem; font-weight: 600; padding: 6px 11px; min-height: 36px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip, #fff); color: var(--fg); cursor: pointer; }
.ask-areas button[aria-pressed="true"] { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
.ask-act { font: inherit; font-weight: 700; padding: 10px 14px; min-height: 44px; border-radius: 12px; border: 0; background: #1f5fe0; color: #fff; cursor: pointer; width: 100%; margin: 6px 0 0; }
.ask-wait { color: var(--muted); font-size: .88rem; padding: 6px 0; }`;
  document.head.append(css);

  // ---------- the box (on each sport's Find page) and the answer sheet ----------
  const boxHtml = (sp, cls = "") => `<form class="ask-box ${cls}" data-ask="${sp}" role="search"><label for="askIn-${sp}${cls ? "-" + cls : ""}">💬 Ask in plain words</label>
    <div class="ask-row"><input class="ask-in" id="askIn-${sp}${cls ? "-" + cls : ""}" type="search" enterkeyhint="search" autocomplete="off" placeholder="${esc(SP[sp].ph)}" aria-label="Ask in plain words"><button type="submit" class="ask-go">Ask</button></div></form>`;
  document.addEventListener("submit", (e) => {
    const f = e.target.closest && e.target.closest("form[data-ask]");
    if (!f) return;
    e.preventDefault();
    const inp = f.querySelector(".ask-in"), q = inp.value.trim();
    inp.blur();
    open(q);
  });
  // MTB on a computer: above Where to ride today (on phones it's on the Find page, index.html's hubHtml).
  const desk = () => {
    if (document.querySelector("form.ask-desk")) return;
    const a = $("todayBtn") || $("wantList");
    if (a) a.insertAdjacentHTML("beforebegin", boxHtml("mtb", "ask-desk"));
  };
  // The other sports: in their own panel, under their buttons. Adventure moto's panel comes when Moto is first picked.
  const PANES = { ski: ["#skiPane", "#skPlaces"], hunt: ["#huntPane", ".ps-box"], fish: ["#fishPane", ".ps-box"], moto: ["#motoPane", ".ps-box"] };
  function mount() {
    desk();
    let left = 0;
    for (const [sp, [pane, after]] of Object.entries(PANES)) {
      const p = document.querySelector(pane);
      if (!p) { left++; continue; }
      if (p.querySelector("form.ask-box")) continue;
      const a = p.querySelector(after);
      if (a) a.insertAdjacentHTML("afterend", boxHtml(sp)); else p.insertAdjacentHTML("afterbegin", boxHtml(sp));
    }
    return left;
  }
  if (mount()) {
    const mo = new MutationObserver(() => { if (!mount()) mo.disconnect(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  const dlg = document.createElement("dialog");
  dlg.className = "ask-dlg";
  dlg.tabIndex = -1;   // the sheet itself takes the focus, not the ✕ (and the phone's keyboard stays down)
  dlg.innerHTML = `<h2><span>💬 Ask</span><button type="button" aria-label="Close">✕</button></h2><div class="ask-top"></div><div class="ask-head"></div><div class="ask-out"></div>`;
  document.body.append(dlg);
  dlg.querySelector("h2 button").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });   // a tap outside the sheet
  const close = () => { if (dlg.open) dlg.close(); };

  let token = 0;
  async function open(q) {
    const sp = sportOf(), my = ++token;
    dlg.querySelector(".ask-top").innerHTML = boxHtml(sp, "ask-in-dlg");
    const inp = dlg.querySelector(".ask-in");
    inp.value = q || "";
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); } dlg.focus(); }
    const head = dlg.querySelector(".ask-head"), out = dlg.querySelector(".ask-out");
    if (!q) {
      head.innerHTML = "";
      out.innerHTML = `<p class="ask-note">Type what you're after, the way you'd ask a friend. For example:</p><div class="ask-ex">${SP[sp].ex.map((x) => `<button type="button">${esc(x)}</button>`).join("")}</div>`;
      out.querySelectorAll(".ask-ex button").forEach((b) => b.addEventListener("click", () => open(b.textContent)));
      setTimeout(() => inp.focus(), 50);
      return;
    }
    head.innerHTML = `<p class="ask-wait">Reading your question…</p>`;
    out.innerHTML = "";
    const ai = await aiParse(q, sp);
    if (my !== token) return;
    const p = ai.ok ? fromAi(ai, q, sp) : localParse(q, sp);
    head.innerHTML = `<p class="ask-said">${esc(p.summary || summaryOf(p, sp))}</p><ul class="ask-chips">${chipsOf(p, sp).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
      ${ai.ok ? "" : `<p class="ask-note">${esc(ai.why)} Read here more simply: ask again later for a smarter read.</p>`}`;
    out.innerHTML = `<p class="ask-wait">Finding the place…</p>`;
    const at = await whereOf(p);
    if (my !== token) return;
    if (!at) { out.innerHTML = `<p class="ask-note ask-warn">Couldn't find “${esc(p.place)}” on the map. Try the town's name, or move the map there and ask “near here”.</p>`; return; }
    out.innerHTML = `<p class="ask-wait">Looking ${at.you ? "around you" : at.mid ? "around the middle of the map" : "near " + esc(at.name)}…</p>`;
    try { await ANSWER[sp](p, at, out, () => my !== token); }
    catch (e) { if (my === token) out.innerHTML = `<p class="ask-note ask-warn">Something went wrong (${esc(e.message || e)}). Try again.</p>`; }
  }

  // ---------- reading the question ----------
  // The AI, in the photo function (supabase/functions/which-trail, mode "ask"). Its answer, or why not.
  let aiOff = "";
  async function aiParse(q, sport) {
    if (aiOff) return { ok: false, why: aiOff };
    const acct = window.tfAccount;
    try {
      if (!acct || !acct.enabled) return { ok: false, why: "The AI isn't available here." };
      await acct.load();
      if (!acct.client) return { ok: false, why: "The AI isn't available here." };
      const { data, error } = await acct.client.functions.invoke(AI_FN, { timeout: 25000, body: { mode: "ask", q, sport, today: localDay() } });
      if (error) {
        const st = error.context && error.context.status;
        let msg = "";
        try { msg = (await error.context.json()).error || ""; } catch {}
        // An older copy of the function takes every question for a picture: "no picture".
        if (st === 400 && /picture/i.test(msg)) { aiOff = "The AI needs a small update first."; return { ok: false, why: aiOff }; }
        if (st === 429) return { ok: false, why: msg ? msg[0].toUpperCase() + msg.slice(1) + "." : "The AI's questions for today are used up." };
        return { ok: false, why: "The AI didn't answer." };
      }
      return data && data.ok ? data : { ok: false, why: "The AI didn't answer." };
    } catch { return { ok: false, why: "The AI didn't answer (no signal?)." }; }
  }
  const blank = (sp) => ({ what: "", place: "", ll: null, near_me: false, date: localDay(), hours: 0, km: 0, km_away: 0, levels: [], loam: false, new_only: false, not_ridden: false, species: "", words: [], summary: "", sport: sp });
  const WHAT = { mtb: ["loop", "trails", "areas"], ski: ["tours", "huts", "avalanche"], hunt: ["spot"], fish: ["waters", "spot"], moto: ["routes", "spot"] };
  function fromAi(a, q, sp) {
    const p = { ...blank(sp), ...a, sport: sp, q };
    if (!WHAT[sp].includes(p.what)) p.what = localParse(q, sp).what;
    // The place read here when the AI didn't name one (it sometimes keeps it for the summary only).
    if (!p.place && !p.near_me) { const l = localParse(q, sp); p.place = l.place; }
    if (p.date < localDay()) p.date = localDay();
    return p;
  }
  const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const SPECIES = /\b(elk|moose|deer|mule deer|white-?tailed deer|whitetail|black bear|bear|cougar|wolf|coyote|bighorn|sheep|mountain goat|goat|caribou|grouse|ptarmigan|duck|goose|turkey|pheasant|rabbit|hare|rainbow trout|cutthroat|bull trout|brook trout|lake trout|brown trout|trout|kokanee|char|salmon|chinook|coho|steelhead|walleye|pike|bass|perch|whitefish|sturgeon|halibut|lingcod|rockfish|crab|prawn)s?\b/;
  // A simpler read of the words, here: used when the AI isn't there.
  function localParse(q, sp) {
    const p = blank(sp), s = q.toLowerCase().replace(/[’']/g, "'");
    p.q = q;
    // The day
    const today = localDay(), wd = new Date().getDay();
    let m;
    if (/\btomorrow\b/.test(s)) p.date = addDays(today, 1);
    else if ((m = s.match(/\bin (\d) days?\b/))) p.date = addDays(today, +m[1]);
    else if (/\b(this )?weekend\b/.test(s)) p.date = addDays(today, (6 - wd + 7) % 7);
    else { const i = DAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(s)); if (i >= 0) p.date = addDays(today, (i - wd + 7) % 7); }
    // How long
    if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:-|\s)?\s*(?:h|hr|hrs|hour|hours)\b/))) p.hours = +m[1].replace(",", ".");
    else if ((m = s.match(/(\d+)\s*(?:-|\s)?\s*(?:min|mins|minutes)\b/))) p.hours = Math.round((+m[1] / 60) * 4) / 4;
    else if (/\bhalf[- ]day\b/.test(s)) p.hours = 4;
    else if (/\b(an|one) hour\b/.test(s)) p.hours = 1;
    else if (/\bfull[- ]day\b|\ball[- ]day\b/.test(s)) p.hours = 6;
    if ((m = s.match(/\b(within|less than \d+ ?km from|up to)\s*(\d+)\s*km\b/))) p.km_away = +m[2];
    else if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:-|\s)?\s*(?:km|kms|kilomet\w*)\b/))) p.km = +m[1].replace(",", ".");
    // Levels
    const lv = new Set();
    if (/\bdouble[- ]black\b|\bexpert\b|\bpro line\b|\bgnar/.test(s)) lv.add("dbl");
    if (/\bblack\b/.test(s.replace(/double[- ]black/g, "")) || /\bhard\b|\btechnical\b|\btech\b|\badvanced\b|\bchallenging\b|\bcomplex\b/.test(s)) lv.add("black");
    if (/\bblue\b|\bintermediate\b|\bmoderate\b|\bmedium\b/.test(s)) lv.add("blue");
    if (/\bgreen\b|\beasy\b|\bbeginner\b|\bsimple\b|\bmellow\b|\bchill\b/.test(s)) lv.add("green");
    p.levels = [...lv];
    p.loam = /\bloam|\btacky\b|\bhero dirt\b|\bprime\b|\bperfect dirt\b|\bgood dirt\b|\bconditions\b/.test(s);
    p.new_only = /\bnew\b(?! to me)|\brecent(ly)?\b/.test(s) && !/\bnew to me\b/.test(s);
    p.not_ridden = /\b(havent|haven't|have not|never|not yet) (ridden|ride|done|been)\b|\bnew to me\b|\bunridden\b/.test(s);
    if ((m = s.match(SPECIES))) p.species = m[1];
    // What
    if (sp === "mtb") p.what = /\bloop\b|\bride of\b|\bhour\b|\bhours\b|\d\s*h\b|\bkm\b|\bmin/.test(s) ? "loop" : /\bwhere (to|should|can|do) (i |we )?ride\b|\bwhich area|\bareas?\b|\bride today\b/.test(s) ? "areas" : "trails";
    else if (sp === "ski") p.what = /\bhut|\bcabin/.test(s) ? "huts" : /\bavalanche|\bavy\b|\bdanger\b/.test(s) ? "avalanche" : "tours";
    else if (sp === "hunt") p.what = "spot";
    else if (sp === "fish") p.what = /\brule|\bregulation|\blimit\b|\bseason\b|\bopen\b|\bclosed?\b|\blicen/.test(s) ? "spot" : "waters";
    else p.what = /\bgas\b|\bfuel\b|\bcamp|\bride here\b|\bhot spring/.test(s) ? "spot" : "routes";
    p.words = ["views", "flowy", "jumps", "lake", "quiet", "dirt", "paved", "gravel", "nordic", "snowshoe", "snowmobile", "classic", "skate"].filter((w) => s.includes(w));
    // The place: after near, around, close to, at, by or in (in only before a capital: "in prime loam" isn't a place).
    p.near_me = /\b(near|around|close to) (me|here|us)\b|\bnearby\b|\bclose by\b/.test(s);
    if (!p.near_me) {
      const STOP = "today|tomorrow|tonight|this|next|on|with|for|in|under|over|within|that|which|i|we|and|or|the weekend|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|loop|trails?|please";
      const W = "(?!(?:I|Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\b)[A-ZÀ-Ý][\\w'’.-]*";
      const cap = q.match(new RegExp(`\\b(?:near|around|close to|at|by|in|from|to)\\s+(${W}(?:\\s+(?:${W}|de|du|des|la|le|of))*)`));
      const low = s.match(new RegExp(`\\b(?:near|around|close to)\\s+([a-zà-ÿ][a-zà-ÿ'.-]*(?:\\s+(?!(?:${STOP})\\b)[a-zà-ÿ][a-zà-ÿ'.-]*){0,3})`));
      p.place = ((cap && cap[1]) || (low && low[1]) || "").replace(/\s+(?:de|du|des|la|le|of)$/i, "").trim();
    }
    return p;
  }
  const LV = { green: ["●", "#2f9e44", "Green"], blue: ["■", "#1c6fe0", "Blue"], black: ["◆", "#1b1b1b", "Black"], dbl: ["◆◆", "#d6202a", "Double black"], pro: ["▲", "#e8590c", "Pro line"] };
  const hrs = (h) => (h % 1 ? `${Math.floor(h)} h ${Math.round((h % 1) * 60)}` : `${h} h`);
  function chipsOf(p, sp) {
    const out = [];
    out.push(p.near_me || !p.place ? "📍 Near you" : `📍 ${p.place}`);
    if (p.date !== localDay() || p.loam) out.push(`📅 ${dayName(p.date)[0].toUpperCase() + dayName(p.date).slice(1)}`);
    if (p.hours) out.push(`⏱ ${hrs(p.hours)}`);
    if (p.km) out.push(`↔ ${p.km} km`);
    if (p.km_away) out.push(`within ${p.km_away} km`);
    if (sp === "mtb" || sp === "ski") p.levels.forEach((l) => out.push(sp === "ski" ? ["Simple", "Challenging", "Complex", "Complex"][["green", "blue", "black", "dbl"].indexOf(l)] : LV[l][2]));
    if (p.loam && sp === "mtb") out.push("🤎 Prime loam");
    if (p.new_only) out.push("✨ New");
    if (p.not_ridden && sp === "mtb") out.push("Not ridden yet");
    if (p.species) out.push(p.species[0].toUpperCase() + p.species.slice(1));
    return out;
  }
  function summaryOf(p, sp) {
    const what = { loop: "Loops", trails: "Trails", areas: "Where to ride", tours: "Tours", huts: "Huts", avalanche: "The avalanche forecast", spot: sp === "hunt" ? "What you can hunt" : sp === "fish" ? "Fishing rules and conditions" : "What's there", waters: "Waters to fish", routes: "ADV routes" }[p.what] || "What there is";
    return `${what} ${p.near_me || !p.place ? "near you" : "near " + p.place}`;
  }

  // ---------- the place ----------
  let areasP = null;
  const ridingAreas = () => areasP || (areasP = fetch("data/riding-areas.json").then((r) => r.json()).then((f) => (f.areas || []).filter((a) => Array.isArray(a.c))).catch(() => { areasP = null; return []; }));
  function youOr() {
    const T = window.tfToday, ll = T && T.you();
    if (ll) return Promise.resolve({ c: [ll.lat, ll.lng], you: true });
    const mid = () => { const m = map.getCenter(); return { c: [m.lat, m.lng], mid: true }; };
    if (!navigator.geolocation) return Promise.resolve(mid());
    return new Promise((ok) => navigator.geolocation.getCurrentPosition((x) => ok({ c: [x.coords.latitude, x.coords.longitude], you: true }), () => ok(mid()), { timeout: 8000, maximumAge: 600000 }));
  }
  // The place named: a riding area or zone by its name, else the place search (OpenStreetMap), else the AI's own spot.
  async function whereOf(p) {
    if (p.near_me || !p.place) return youOr();
    const n = norm(p.place);
    if (p.sport === "mtb") {
      const a = (await ridingAreas()).find((x) => norm(x.name) === n);
      if (a) return { c: a.c, name: a.name, area: a };
    }
    const ps = window.tfPlaceSearch;
    if (ps) {
      const hits = await Promise.race([ps.search(p.place).catch(() => null), new Promise((r) => setTimeout(() => r(null), 8000))]);
      const h = hits && (hits.find((x) => x.ca) || (!p.ll && hits[0]));
      if (h) return { c: [h.lat, h.lon], name: h.name, bb: h.bb };
    }
    if (p.ll) return { c: p.ll, name: p.place };
    return null;
  }

  // ---------- the answers ----------
  const lvGlyph = (k) => (LV[k] ? `<span class="ask-lv" style="color:${LV[k][1]}" title="${LV[k][2]}">${LV[k][0]}</span>` : "");
  const LOAM = [[20, "Dry", "#d9a35a"], [40, "Tacky", "#5aa86a"], [60, "Prime", "#3f8f8c"], [80, "Wet", "#3b6fb0"], [101, "Saturated", "#33468f"]];
  const loamLv = (v) => LOAM.find((l) => v < l[0]);
  const loamDot = (v) => `<i class="ask-dot" style="background:${v == null ? "#8a8f98" : loamLv(v)[2]}"></i>`;
  const isPrime = (v) => v != null && v >= 40 && v < 60;
  const listHtml = (rows) => `<ol class="ask-list">${rows.map((r, i) => `<li><button type="button" data-i="${i}"><b>${r.title}</b><small>${r.sub}</small></button></li>`).join("")}</ol>`;
  const wire = (el, rows) => el.querySelectorAll("ol.ask-list button[data-i]").forEach((b) => b.addEventListener("click", () => { close(); rows[+b.dataset.i].go(); }));
  const nearName = (at) => (at.you ? "you" : at.mid ? "the middle of the map" : at.name);

  const ANSWER = {
    // MTB: the trails within reach, read for the day asked.
    async mtb(p, at, out, stale) {
      const T = window.tfToday;
      if (!T || !window.tfZoneTrails) { out.innerHTML = `<p class="ask-note">The trail lists aren't loaded yet. Try again in a moment.</p>`; return; }
      const R = p.km_away || (at.area ? 12 : at.you ? 40 : 25);
      const zs = await T.zonesNear(at.c, R);
      if (stale()) return;
      if (!zs.length) { out.innerHTML = `<p class="ask-note">No trails within ${R} km of ${esc(nearName(at))}.</p>`; return; }
      out.innerHTML = `<p class="ask-wait">Reading the trails and the loam…</p>`;
      const [lists, areasAll, born] = await Promise.all([Promise.all(zs.map((z) => window.tfZoneTrails(z.id).catch(() => []))), ridingAreas(), T.firstMappedIn(zs).catch(() => null)]);
      if (stale()) return;
      let trails = lists.flat().filter((t) => t.c && kmTo(t.c, at.c) <= R).map((t) => ({ ...t, km: kmTo(t.c, at.c) }));
      const areas = areasAll.filter((a) => zs.some((z) => z.id === a.zone) && kmTo(a.c, at.c) <= R + 5).map((a) => ({ ...a, km: kmTo(a.c, at.c), trails: [] }));
      trails.forEach((t) => { let best = null, d = 10; areas.forEach((a) => { const k = kmTo(t.c, a.c); if (k < d) { d = k; best = a; } }); t.area = best; if (best) best.trails.push(t); });
      // The loam that day, the same reading as everywhere in the app (snow on the ground is never prime).
      const day = p.date, read = window.tfLoamDay ? await window.tfLoamDay(trails.map((t) => t.c), day).catch(() => null) : null;
      if (stale()) return;
      const fdays = read ? Math.max(0, ...read.map((x) => x.days)) : 0, far = day > addDays(localDay(), fdays);
      trails.forEach((t, i) => { const x = read && read[i]; t.v = x ? x.v : null; t.snow = x && x.snow >= (window.tfSnowCm || 5); t.prime = isPrime(t.v) && !t.snow; });
      const newSince = Date.now() - 183 * 864e5;
      trails.forEach((t) => { const ts = born ? t.ids.map((id) => born.get(id)).filter(Boolean) : []; t.isNew = ts.length === t.ids.length && ts.length > 0 && Math.min(...ts) >= newSince; });
      const ridden = T.ridden();
      const dn = dayName(day), loamWord = (t) => (t.snow ? "❄ Snow" : t.v == null ? "Loam not known" : `${loamLv(t.v)[1]} · Loam ${t.v}`);
      const farNote = far && p.loam ? `<p class="ask-note ask-warn">The loam forecast only goes ${fdays} day${fdays === 1 ? "" : "s"} ahead: ${esc(dn)} isn't known yet.</p>` : "";
      const lvOk = (t) => !p.levels.length || p.levels.includes(t.lvl) || (p.levels.includes("dbl") && t.lvl === "pro");

      if (p.what === "areas" || p.what === "loop") {
        // Riding areas, best first: the most trails in prime loam that day (when asked, or always for "where to ride"), then nearest.
        const scored = areas.filter((a) => a.trails.length >= 2).map((a) => {
          const rd = a.trails.filter((t) => t.v != null), pr = rd.filter((t) => t.prime);
          return { a, pr: pr.length, rd: rd.length, share: rd.length ? (pr.length / rd.length) * Math.min(1, rd.length / 5) : 0, park: /\bbike ?park\b/i.test(a.name) };
        });
        const byLoam = p.loam || p.what === "areas";
        scored.sort((x, y) => (x.park - y.park) || (byLoam ? (y.share > 0) - (x.share > 0) || y.share - x.share : 0) || x.a.km - y.a.km);
        if (!scored.length) { out.innerHTML = `${farNote}<p class="ask-note">No riding areas within ${R} km of ${esc(nearName(at))}.</p>`; return; }
        const areaLine = (s) => s.rd ? (s.pr ? `${s.pr} of ${s.rd} trails in prime loam ${esc(dn)}` : `No trail in prime loam ${esc(dn)}`) : `Loam ${esc(dn)} not known`;
        if (p.what === "areas") {
          const rows = scored.slice(0, 8).map((s) => ({ title: esc(s.a.name), sub: `${loamDot(s.pr ? 50 : null)}${areaLine(s)} · ${fmtKm(s.a.km)} away · ${s.a.trails.length} trails`,
            go: () => { map.flyTo(s.a.c, 13); if (window.tfSnapTo) window.tfSnapTo("peek"); } }));
          out.innerHTML = `${farNote}<h3>Riding areas ${at.you ? "near you" : "near " + esc(at.name || "the map")}</h3>${listHtml(rows)}<p class="ask-note">Tap one to go there. ☀ Where to ride today has each area's rider reports, closures and fires.</p>`;
          wire(out, rows);
          return;
        }
        // Loops (loops.js): from the parking lot nearest the trails, never bike park trails, at the length asked.
        if (!window.tfLoops) { out.innerHTML = `<p class="ask-note">Loops aren't available here.</p>`; return; }
        if (window.tfLoops.setWant && (p.hours || p.km)) window.tfLoops.setWant({ km: p.km || null, h: p.hours || null });
        const top = scored.filter((s) => !s.park).slice(0, 5);
        if (!top.length) { out.innerHTML = `<p class="ask-note">Only bike parks near ${esc(nearName(at))}: their trails are reached by the lifts, so no pedal loop.</p>`; return; }
        const lvlNote = p.levels.length ? `<p class="ask-note">Each area has an easy, a classic, a technical and a big loop: ${p.levels.includes("green") ? "the Easy loop is green and blue trails." : p.levels.includes("black") || p.levels.includes("dbl") ? "the Technical loop is black and double black trails." : "the Classic loop is blue and black trails."}</p>` : "";
        out.innerHTML = `${farNote}<h3>Loops ${p.loam ? `where the loam is best ${esc(dn)}` : "near " + esc(at.you ? "you" : at.name || "the map")}</h3>
          <div class="ask-areas">${top.map((s, i) => `<button type="button" data-a="${i}" aria-pressed="${i === 0}">${esc(s.a.name)}</button>`).join("")}</div>
          <p class="ask-note ask-aline"></p>${lvlNote}<div class="ask-loops"></div>`;
        const box = out.querySelector(".ask-loops"), line = out.querySelector(".ask-aline");
        const pick = (i) => {
          const s = top[i];
          out.querySelectorAll(".ask-areas button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.a === i)));
          line.innerHTML = `${loamDot(s.pr ? 50 : null)}${areaLine(s)} · ${fmtKm(s.a.km)} away`;
          window.tfLoops.show(box, s.a, close);
        };
        out.querySelectorAll(".ask-areas button").forEach((b) => b.addEventListener("click", () => pick(+b.dataset.a)));
        pick(0);
        return;
      }

      // Trails
      let pool = trails.filter(lvOk);
      if (p.new_only) pool = pool.filter((t) => t.isNew);
      if (p.not_ridden) pool = pool.filter((t) => !ridden.has(T.nameKey(t.name)));
      const want = p.loam && !far;
      pool.sort((a, b) => (want ? b.prime - a.prime : 0) || (b.isNew - a.isNew) || (b.off - a.off) || a.km - b.km);
      const rows = pool.slice(0, 10).map((t) => ({
        title: `${lvGlyph(t.lvl)}${esc(t.name)}${t.isNew ? `<span class="ask-new">New</span>` : ""}`,
        sub: `${loamDot(t.snow ? null : t.v)}${esc(loamWord(t))} ${esc(dn)}${t.area ? ` · ${esc(t.area.name)}` : ""}${t.lift ? " · 🚡 lift access" : ""} · ${fmtKm(t.km)} away${ridden.has(T.nameKey(t.name)) ? " · ✓ ridden" : ""}`,
        go: () => window.tfShowFound({ type: "w", items: t.ids.map((id) => ({ id })), name: t.name, kind: t.kind, center: L.latLng(t.c[0], t.c[1]) }),
      }));
      const primeN = pool.filter((t) => t.prime).length;
      out.innerHTML = farNote + (rows.length ? `<h3>${pool.length} trail${pool.length === 1 ? "" : "s"}${want ? `, ${primeN} in prime loam ${esc(dn)}` : ""}</h3>${listHtml(rows)}
        ${want && !primeN ? `<p class="ask-note">None of them is in prime loam ${esc(dn)}: the nearest are first.</p>` : ""}${pool.length > rows.length ? `<p class="ask-note">The best ${rows.length} of ${pool.length}. Ask for a level, new trails or an area to narrow it down.</p>` : ""}`
        : `<p class="ask-note">No trail like that within ${R} km of ${esc(nearName(at))}.${p.new_only ? " Nothing new was mapped there in the last 6 months." : ""}</p>`);
      wire(out, rows);
    },

    // Skiing: routes and huts near the place with their risk light (winter.js), or the avalanche forecast there.
    async ski(p, at, out, stale) {
      const S = window.tfSki;
      if (!S || !S.near) { out.innerHTML = `<p class="ask-note">Skiing isn't loaded yet. Try again in a moment.</p>`; return; }
      const s = (p.q || "").toLowerCase() + " " + p.words.join(" ");
      const types = /nordic|cross[- ]country|classic|skate|xc\b/.test(s) ? ["nordic"] : /snowshoe/.test(s) ? ["snowshoe"] : /snowmobile|sled/.test(s) ? ["snowmobile"] : ["tour"];
      const R = p.km_away || 25;
      const near = await S.near(at.c, R, types);
      if (stale()) return;
      const go = (fn) => () => { if (window.tfSnapTo) window.tfSnapTo("half"); fn(); };
      if (p.what === "huts") {
        const rows = near.huts.slice(0, 10).map((h) => ({ title: `🛖 ${esc(h.name)}`, sub: `${esc(h.kind)} · ${fmtKm(h.d / 1000)} away`, go: go(() => S.showHut(h.lat, h.lon)) }));
        out.innerHTML = rows.length ? `<h3>Huts near ${esc(nearName(at))}</h3>${listHtml(rows)}` : `<p class="ask-note">No huts or cabins mapped within ${R} km of ${esc(nearName(at))}.</p>`;
        wire(out, rows);
        return;
      }
      // Terrain class wanted: Simple (1) for easy, Challenging (2), Complex (3).
      const max = p.levels.length ? Math.max(...p.levels.map((l) => ({ green: 1, blue: 2, black: 3, dbl: 3 }[l]))) : 0;
      // An easy tour leaves out the ones mapped as advanced or harder, whatever their terrain class.
      let routes = near.routes.filter((r) => (!max || !r.cls || r.cls <= max) && !(max === 1 && /advanced|expert|extreme|freeride/.test(r.diff)));
      if (p.km) routes = routes.filter((r) => r.km <= p.km * 1.3);
      routes.sort((a, b) => (max ? (!a.cls) - (!b.cls) : 0) || a.d - b.d);
      const rows = routes.slice(0, 10).map((r) => ({ title: esc(r.name), sub: `${r.pill ? r.pill + " · " : ""}${r.km >= 0.05 ? fmtKm(r.km) + " long · " : ""}${fmtKm(r.d / 1000)} away`,
        go: go(() => S.show(r.id, r.c)) }));
      const avy = p.what === "avalanche" ? `<button type="button" class="ask-act" data-avy>⚠ Open the avalanche forecast ${at.you ? "here" : "for " + esc(at.name)}</button>
        <p class="ask-note">${p.date !== localDay() ? `The forecast has the next days too: look for ${esc(dayName(p.date))}. ` : ""}The light on each tour is today's danger in its terrain.</p>` : "";
      out.innerHTML = avy + (rows.length ? `<h3>${{ tour: "Ski tours", nordic: "Nordic trails", snowshoe: "Snowshoe routes", snowmobile: "Snowmobile trails" }[types[0]]} near ${esc(nearName(at))}</h3>${listHtml(rows)}
        <p class="ask-note">Open maps can be wrong and no route is avalanche-safe: check the forecast before you go.</p>`
        : `<p class="ask-note">No ${types[0] === "tour" ? "ski tours" : types[0] + " routes"} like that mapped within ${R} km of ${esc(nearName(at))}.</p>`);
      wire(out, rows);
      const ab = out.querySelector("[data-avy]");
      if (ab) ab.addEventListener("click", () => { close(); map.setView(at.c, 11); setTimeout(() => { const b = $("skNow"); if (b && !b.hidden) b.click(); }, 400); });
    },

    // Hunting: the spot card at the place (zone, what's open today, rules).
    async hunt(p, at, out, stale) {
      const H = window.tfHunt;
      if (!H) { out.innerHTML = `<p class="ask-note">Hunting isn't loaded yet. Try again in a moment.</p>`; return; }
      const zone = H.zoneAt ? await H.zoneAt(at.c[0], at.c[1]).catch(() => "") : "";
      if (stale()) return;
      out.innerHTML = `<h3>${esc(at.you ? "Where you are" : at.name || "This spot")}</h3>
        <p>${zone ? `In <b>${esc(zone)}</b>.` : "No hunting zone found here."}</p>
        <button type="button" class="ask-act" data-go>🦌 See what's open here${p.species ? ` for ${esc(p.species)}` : ""}</button>
        <p class="ask-note">The spot card lists what's open today, the land (parks, no-shooting areas), the season dates and the rules for the zone${p.date !== localDay() ? `: check the dates for ${esc(dayName(p.date))}` : ""}.</p>`;
      out.querySelector("[data-go]").addEventListener("click", () => { close(); H.openAt(at.c[0], at.c[1]); if (window.tfSnapTo) window.tfSnapTo("half"); });
    },

    // Fishing: stocked waters near the place (for the fish named), or the spot card.
    async fish(p, at, out, stale) {
      const F = window.tfFish;
      if (!F) { out.innerHTML = `<p class="ask-note">Fishing isn't loaded yet. Try again in a moment.</p>`; return; }
      const spotBtn = `<button type="button" class="ask-act" data-go>🎣 Open ${at.you ? "this spot" : esc(at.name)}: rules, conditions, what's there</button>`;
      const spot = () => { close(); F.show(at.c[0], at.c[1], at.you ? "" : at.name); if (window.tfSnapTo) window.tfSnapTo("half"); };
      if (p.what === "spot" || !F.stockedNear) { out.innerHTML = spotBtn; out.querySelector("[data-go]").addEventListener("click", spot); return; }
      const R = p.km_away || 30;
      let ws = await F.stockedNear(at.c[0], at.c[1], R);
      if (stale()) return;
      const sp = norm(p.species).replace(/s$/, "");
      if (sp) ws = ws.filter((w) => w.sp.some((x) => norm(x).includes(sp)));
      const when = (d) => (/^\d{4}-\d\d-\d\d$/.test(d || "") ? new Date(d + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : d || "");
      const rows = ws.slice(0, 10).map((w) => ({ title: `💧 ${esc(w.n)}`, sub: `${esc(w.sp.slice(0, 3).join(", "))}${w.last ? ` · last stocked ${esc(when(w.last))}` : ""} · ${fmtKm(w.d)} away`,
        go: () => { F.show(w.c[0], w.c[1], w.n); if (window.tfSnapTo) window.tfSnapTo("half"); } }));
      out.innerHTML = (rows.length ? `<h3>Stocked waters${p.species ? ` with ${esc(p.species)}` : ""} near ${esc(nearName(at))}</h3>${listHtml(rows)}`
        : `<p class="ask-note">No stocked waters${p.species ? ` with ${esc(p.species)}` : ""} within ${R} km of ${esc(nearName(at))} in the stocking reports.</p>`) + spotBtn
        + `<p class="ask-note">From the provinces' stocking reports. Check the rules for each water before you fish.</p>`;
      wire(out, rows);
      out.querySelector("[data-go]").addEventListener("click", spot);
    },

    // Adventure moto: ADV routes near the place (data/moto-routes.json), or the spot card.
    async moto(p, at, out, stale) {
      const spot = () => { close(); map.setView(at.c, Math.max(map.getZoom(), 11)); map.fire("click", { latlng: L.latLng(at.c[0], at.c[1]) }); };
      if (p.what === "spot") {
        out.innerHTML = `<button type="button" class="ask-act" data-go>🏍 Open ${at.you ? "this spot" : esc(at.name)}: gas, camping, can I ride here</button>`;
        out.querySelector("[data-go]").addEventListener("click", spot);
        return;
      }
      const j = await fetch("data/moto-routes.json").then((r) => r.json()).catch(() => null);
      if (stale()) return;
      const R = p.km_away || 200;
      let rs = ((j && j.routes) || []).filter((t) => t && t.n && t.start).map((t) => ({ t, d: Math.min(kmTo(at.c, t.start), t.end ? kmTo(at.c, t.end) : 1e9) })).filter((x) => x.d <= R);
      if (p.km) rs = rs.filter((x) => (x.t.km || 0) <= p.km * 1.15);
      const s = (p.q || "").toLowerCase();
      const dirt = /\bdirt\b|\bgravel\b|\boff[- ]?road\b/.test(s), easy = p.levels.includes("green") || /\beasy\b/.test(s), hard = p.levels.some((l) => l === "black" || l === "dbl");
      if (easy) rs = rs.filter((x) => (x.t.grade || 2) <= 2);
      if (hard) rs = rs.filter((x) => (x.t.grade || 2) >= 3);
      if (dirt) rs = rs.filter((x) => (x.t.dirtPct || 0) >= 50);
      rs.sort((a, b) => a.d - b.d);
      const rows = rs.slice(0, 10).map(({ t, d }) => ({ title: esc(t.n), sub: `${fmtKm(t.km || 0)}${t.dirtPct != null ? ` · ${t.dirtPct}% dirt` : ""} · grade ${t.grade || 2}${t.season ? ` · ${esc(t.season)}` : ""} · starts ${fmtKm(d)} away`,
        go: async () => { if (window.tfLoadMoto) await window.tfLoadMoto().catch(() => {}); if (window.tfMoto && window.tfMoto.openTrip) window.tfMoto.openTrip(t.id); } }));
      out.innerHTML = rows.length ? `<h3>ADV routes near ${esc(nearName(at))}</h3>${listHtml(rows)}<p class="ask-note">Grade 1 is paved, 5 is the roughest. Tap one for its gas stops, camps and Plan it for my bike.</p>`
        : `<p class="ask-note">No ADV route like that within ${R} km of ${esc(nearName(at))}.</p>`;
      wire(out, rows);
    },
  };

  window.tfAsk = { html: (sp) => boxHtml(sp), open, parse: localParse };
})();
